import { ClsServiceManager } from 'nestjs-cls';
import { appendCollectorEntry, readProfile } from '@eleven-labs/nest-profiler';
import type {
  LanguageModelCallEndEvent,
  LanguageModelCallStartEvent,
  ModelMessage,
  ProviderMetadata,
  Telemetry,
} from 'ai';
import { HTTP_ENTRYPOINT_TYPE } from '@eleven-labs/nest-profiler';
import { AI_ENTRIES_KEY } from './ai-call.interface';
import { estimateCost } from './ai-pricing';
import { AI_ENTRYPOINT_TYPE } from './ai-entrypoint';
import { isMcpTool, mcpToolNamesOf } from './mcp-tool-registry';
import { agentFrameworkOf, currentAiAgent } from './ai-agent';
import type { AiAgentInfo } from './ai-agent';
import {
  captureDiagnostic,
  type AiCaptureField,
  captureLevelOf,
  captureSchema,
  captureText,
  captureUrl,
  captureValue,
  maxCapturedMessages,
} from './ai-capture';
import type {
  AiApproval,
  AiToolOrigin,
  AiCallEntry,
  AiCallSettings,
  AiEntry,
  AiMessage,
  AiMessagePart,
  AiTokenUsage,
  AiToolCall,
  AiToolDefinition,
  AiToolExecutionEntry,
} from './ai-call.interface';

/** Whether a profiled HTTP request that called a model is promoted to the `ai` kind. */
let promoteEntrypoint = true;

export function configureAiEntrypointPromotion(enabled: boolean): void {
  promoteEntrypoint = enabled;
}

interface Operation {
  id: string;
  startedAt: number;
  /** The AI SDK's `runtimeContext`, captured once for every call of this operation. */
  context?: unknown;
  /**
   * The tools of this operation that came from an MCP server, read off the tool set the start
   * event carries — the last point at which a tool still says where it came from.
   */
  mcpTools?: Set<string>;
  /** The agent that drove this operation, when one did. */
  agent?: AiAgentInfo;
  provider?: string;
  model?: string;
  instructions?: string;
  messages?: AiMessage[];
  settings?: AiCallSettings;
  toolChoice?: string;
  /** `generateObject` only: the output strategy and the schema the model had to satisfy. */
  outputStrategy?: string;
  outputSchema?: unknown;
  schemaName?: string;
  /** Model calls seen so far, which is the step number of the next one. */
  steps: number;
  /** The last call recorded for this operation, so the operation's result can be folded into it. */
  lastCall?: AiCallEntry;
}

interface PendingCall {
  startedAt: number;
  instructions?: string;
  messages?: AiMessage[];
  tools?: AiToolDefinition[];
  settings?: AiCallSettings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Describes an attachment without ever recording it. A file part carries the bytes themselves, or
 * a URL, or a provider reference — a profile keeps the shape and the size, never the payload.
 */
function describeAttachment(part: Record<string, unknown>): AiMessagePart {
  const data = part['data'] ?? part['image'];
  const mediaType = part['mediaType'];
  const filename = part['filename'];
  const described: AiMessagePart = {
    type: 'file',
    ...(typeof filename === 'string' && { name: filename }),
    ...(typeof mediaType === 'string' && { mediaType }),
  };

  // A URL is a pointer, but a signed one carries its credential in the query string.
  const pointer = (url: string): AiMessagePart => {
    const captured = captureUrl(url, 'messages');
    return { ...described, ...(captured !== undefined && { url: captured }) };
  };

  const describe = (value: unknown): AiMessagePart | undefined => {
    // Structural rather than `instanceof URL`: the URL may come from another realm.
    if (isRecord(value) && typeof value['href'] === 'string') {
      return pointer(value['href']);
    }
    if (typeof value === 'string') {
      return value.startsWith('http') || value.startsWith('data:')
        ? { ...pointer(value), bytes: value.length }
        : { ...described, bytes: value.length };
    }
    if (ArrayBuffer.isView(value)) return { ...described, bytes: value.byteLength };
    if (value instanceof ArrayBuffer) return { ...described, bytes: value.byteLength };
    return undefined;
  };

  // The data is either the bare value or a tagged `{ type, url | data | reference | text }`.
  const tagged = isRecord(data)
    ? (data['url'] ?? data['data'] ?? data['reference'] ?? data['text'])
    : undefined;
  const pointed = describe(data) ?? describe(tagged);
  if (pointed !== undefined) return pointed;
  // Read last: inline bytes arrive as a base64 string of any size, and masking one would cost
  // more than the whole call it belongs to.
  const value = captureValue(tagged ?? data, 'messages');
  return { ...described, ...(value !== undefined && { value }) };
}

/**
 * The field a message part's payload is captured under. A tool payload is a tool payload wherever
 * it turns up — the conversation carries the same arguments and results back to the model, and a
 * host that asked for them not to be stored means it there too.
 */
function fieldOfPart(type: string): AiCaptureField {
  if (type === 'tool-result' || type === 'tool-error' || type === 'tool-output-error') {
    return 'toolResults';
  }
  return type.startsWith('tool-') ? 'toolArguments' : 'messages';
}

/** A tool result travels as `{ type: 'json', value }`; the panel wants the value, not the envelope. */
function unwrapToolOutput(value: unknown): unknown {
  return isRecord(value) && 'value' in value && typeof value['type'] === 'string'
    ? value['value']
    : value;
}

/** Splits a message's content into the text a panel shows and the parts it lists separately. */
function toMessage(message: ModelMessage): AiMessage {
  const origin = { role: message.role };
  if (typeof message.content === 'string') {
    const text = captureText(message.content, 'messages', origin);
    return { role: message.role, ...(text !== undefined && { text }) };
  }

  const texts: string[] = [];
  const parts: AiMessagePart[] = [];
  for (const part of message.content) {
    if (part.type === 'text') {
      texts.push(part.text);
      continue;
    }
    const raw = part as unknown as Record<string, unknown>;
    if (part.type === 'file' || part.type === 'image') {
      parts.push(describeAttachment(raw));
      continue;
    }
    const name =
      raw['toolName'] ?? (isRecord(raw['toolCall']) ? raw['toolCall']['toolName'] : undefined);
    // An approval carries its decision, which must not be hidden behind its reason.
    const value =
      part.type === 'tool-approval-response'
        ? { approved: raw['approved'] === true, reason: raw['reason'] }
        : part.type === 'tool-approval-request'
          ? { reason: raw['reason'] }
          : unwrapToolOutput(raw['input'] ?? raw['output']);
    const captured = captureValue(value, fieldOfPart(part.type), {
      ...origin,
      ...(typeof name === 'string' && { tool: name }),
    });
    parts.push({
      type: part.type,
      ...(typeof name === 'string' && { name }),
      ...(captured !== undefined && { value: captured }),
    });
  }

  const text = texts.length > 0 ? captureText(texts.join(''), 'messages', origin) : undefined;
  return {
    role: message.role,
    ...(text !== undefined && { text }),
    ...(parts.length > 0 && { parts }),
  };
}

function toMessages(messages: readonly ModelMessage[]): AiMessage[] | undefined {
  if (captureLevelOf('messages') === 'none') return undefined;
  const mapped = messages.slice(-maxCapturedMessages()).map(toMessage);
  return mapped.length > 0 ? mapped : undefined;
}

function messagesOf(event: LanguageModelCallStartEvent): AiMessage[] | undefined {
  return toMessages(event.messages);
}

function toInstructions(instructions: unknown): string | undefined {
  if (instructions === undefined || instructions === null) return undefined;
  const list = Array.isArray(instructions) ? instructions : [instructions];
  const text = list
    .map((item: unknown) =>
      typeof item === 'string' ? item : String(isRecord(item) ? item['content'] : ''),
    )
    .filter((item) => item !== '')
    .join('\n');
  return captureText(text, 'instructions');
}

/** The conversation an operation-level start event carries, under whichever field it used. */
function operationMessages(raw: Record<string, unknown>): AiMessage[] | undefined {
  const messages = raw['messages'];
  if (Array.isArray(messages)) return toMessages(messages as ModelMessage[]);
  const prompt = raw['prompt'];
  if (Array.isArray(prompt)) return toMessages(prompt as ModelMessage[]);
  if (typeof prompt === 'string') {
    if (captureLevelOf('messages') === 'none') return undefined;
    const text = captureText(prompt, 'messages', { role: 'user' });
    return [{ role: 'user', ...(text !== undefined && { text }) }];
  }
  return undefined;
}

/** A provider warning as one readable line, whatever shape the provider gave it. */
function describeError(error: unknown): string {
  if (isRecord(error)) {
    const message = error['message'];
    if (typeof message === 'string' && message !== '') return message;
    try {
      return JSON.stringify(error) ?? 'unknown error';
    } catch {
      return 'unknown error';
    }
  }
  return typeof error === 'string' ? error : (JSON.stringify(error) ?? 'unknown error');
}

function describeWarning(warning: unknown): string {
  if (typeof warning === 'string') return warning;
  if (isRecord(warning) && typeof warning['message'] === 'string') return warning['message'];
  try {
    return JSON.stringify(warning) ?? 'unknown warning';
  } catch {
    return 'unknown warning';
  }
}

/** The operation-level usage shape, which nests its details exactly like the model call's. */
function flatUsage(usage: Record<string, unknown>): AiTokenUsage {
  const input = isRecord(usage['inputTokenDetails']) ? usage['inputTokenDetails'] : {};
  const output = isRecord(usage['outputTokenDetails']) ? usage['outputTokenDetails'] : {};
  const num = (value: unknown): number | undefined =>
    typeof value === 'number' ? value : undefined;
  const entry: AiTokenUsage = {
    ...(num(usage['inputTokens']) !== undefined && { input: num(usage['inputTokens']) }),
    ...(num(input['cacheReadTokens']) !== undefined && {
      cacheRead: num(input['cacheReadTokens']),
    }),
    ...(num(input['cacheWriteTokens']) !== undefined && {
      cacheWrite: num(input['cacheWriteTokens']),
    }),
    ...(num(usage['outputTokens']) !== undefined && { output: num(usage['outputTokens']) }),
    ...(num(output['reasoningTokens']) !== undefined && {
      reasoning: num(output['reasoningTokens']),
    }),
    ...(num(usage['totalTokens']) !== undefined && { total: num(usage['totalTokens']) }),
  };
  return entry;
}

function instructionsOf(event: LanguageModelCallStartEvent): string | undefined {
  return toInstructions(event.instructions);
}

/**
 * Where a tool came from. A provider-defined tool runs inside the model (a hosted web search),
 * an MCP one was discovered at runtime, and everything else was declared in this codebase.
 */
function originOf(name: string, providerDefined = false, mcpTools?: Set<string>): AiToolOrigin {
  if (providerDefined) return 'provider';
  // What this operation actually declared wins over the process-wide list a host may have filled:
  // it is scoped to the call rather than matched on a name that another tool could share.
  return mcpTools?.has(name) === true || isMcpTool(name) ? 'mcp' : 'local';
}

/** The tools as the provider received them — name, origin, description and the input schema. */
function toolsOf(
  event: LanguageModelCallStartEvent,
  mcpTools?: Set<string>,
): AiToolDefinition[] | undefined {
  if (captureLevelOf('toolDefinitions') === 'none') return undefined;
  const tools = event.tools?.filter(isRecord).map((tool) => {
    const name = typeof tool['name'] === 'string' ? tool['name'] : 'unknown';
    const description =
      typeof tool['description'] === 'string'
        ? captureText(tool['description'], 'toolDefinitions', { tool: name })
        : undefined;
    const inputSchema = captureSchema(tool['inputSchema'], 'toolDefinitions');
    return {
      name,
      origin: originOf(name, tool['type'] === 'provider-defined', mcpTools),
      ...(description !== undefined && { description }),
      ...(inputSchema !== undefined && { inputSchema }),
    };
  });
  return tools?.length ? tools : undefined;
}

/** `toolChoice` is only carried by the operation-level start event, and only for text generation. */
function toolChoiceOf(event: unknown): string | undefined {
  const choice = isRecord(event) ? event['toolChoice'] : undefined;
  if (typeof choice === 'string') return choice;
  if (isRecord(choice) && choice['type'] === 'tool') return `tool:${String(choice['toolName'])}`;
  return undefined;
}

const NUMERIC_SETTINGS = [
  'temperature',
  'maxOutputTokens',
  'topP',
  'topK',
  'presencePenalty',
  'frequencyPenalty',
  'seed',
] as const;

/** Reads the sampling settings off any event that carries them, model-call or operation. */
function settingsOf(event: unknown): AiCallSettings | undefined {
  if (!isRecord(event)) return undefined;
  const settings: AiCallSettings = {};
  for (const key of NUMERIC_SETTINGS) {
    const value = event[key];
    if (typeof value === 'number') settings[key] = value;
  }
  const stop = event['stopSequences'];
  if (Array.isArray(stop) && stop.length > 0) {
    settings.stopSequences = stop.filter((item): item is string => typeof item === 'string');
  }
  return Object.keys(settings).length > 0 ? settings : undefined;
}

function usageOf(event: LanguageModelCallEndEvent): AiTokenUsage | undefined {
  const { usage } = event;
  const entry: AiTokenUsage = {
    ...(usage.inputTokens !== undefined && { input: usage.inputTokens }),
    ...(usage.inputTokenDetails.cacheReadTokens !== undefined && {
      cacheRead: usage.inputTokenDetails.cacheReadTokens,
    }),
    ...(usage.outputTokens !== undefined && { output: usage.outputTokens }),
    ...(usage.outputTokenDetails.reasoningTokens !== undefined && {
      reasoning: usage.outputTokenDetails.reasoningTokens,
    }),
    ...(usage.totalTokens !== undefined && { total: usage.totalTokens }),
  };
  return Object.keys(entry).length > 0 ? entry : undefined;
}

/**
 * USD cost the provider reported, read generically from `providerMetadata`: OpenRouter files it
 * under `openrouter.usage.cost`, and every provider that reports one uses the same shape.
 */
function costOf(metadata: ProviderMetadata | undefined): number | undefined {
  for (const value of Object.values(metadata ?? {})) {
    const cost = (value as { usage?: { cost?: unknown } }).usage?.cost;
    if (typeof cost === 'number') return cost;
  }
  return undefined;
}

/**
 * What the call cost. The provider's own figure wins — it is what will be invoiced — and the
 * token prices the module was configured with fill in for the providers that report none, which
 * is most of them.
 *
 * A provider often answers as something other than the model it was asked for: OpenAI resolves
 * `gpt-4o-mini` to the dated snapshot `gpt-4o-mini-2024-07-18`. The snapshot is what the call is
 * recorded as, since it is what ran, but a price table holds the id an application asks for — so
 * `requested` is tried when the resolved id is priced nowhere.
 */
function priceOf(
  metadata: ProviderMetadata | undefined,
  usage: AiTokenUsage | undefined,
  provider: string,
  model: string,
  requested?: string,
): Pick<AiCallEntry, 'cost' | 'costSource'> {
  const reported = costOf(metadata);
  if (reported !== undefined) return { cost: reported, costSource: 'provider' };
  const fallback =
    requested !== undefined && requested !== model
      ? estimateCost(usage, provider, requested)
      : undefined;
  const estimated = estimateCost(usage, provider, model) ?? fallback;
  if (estimated !== undefined) return { cost: estimated, costSource: 'estimated' };
  return {};
}

/**
 * Approval requests and responses left in a result's content — the human-in-the-loop trail.
 *
 * Read from the *operation's* content rather than the model call's: the SDK decides an approval
 * after the provider has answered, so the parts only exist once the whole generation is over.
 */
function approvalsOf(content: unknown): AiApproval[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const approvals: AiApproval[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part['type'] !== 'tool-approval-request' && part['type'] !== 'tool-approval-response') {
      continue;
    }
    const raw = part;
    const toolCall = isRecord(raw['toolCall']) ? raw['toolCall'] : {};
    const approved = raw['approved'];
    const tool = typeof toolCall['toolName'] === 'string' ? toolCall['toolName'] : 'unknown';
    // A reason is written by a person about this call: content, and captured as such. The
    // decision itself is a fact about the run and is always kept.
    const reason =
      typeof raw['reason'] === 'string'
        ? captureText(raw['reason'], 'toolArguments', { tool })
        : undefined;
    approvals.push({
      approvalId: typeof raw['approvalId'] === 'string' ? raw['approvalId'] : '',
      tool,
      decision:
        raw['type'] === 'tool-approval-request' ? 'requested' : approved ? 'approved' : 'denied',
      ...(reason !== undefined && { reason }),
      ...(raw['isAutomatic'] === true && { automatic: true }),
    });
  }
  return approvals.length > 0 ? approvals : undefined;
}

function contentOf(
  event: LanguageModelCallEndEvent,
  mcpTools?: Set<string>,
): {
  completion?: string;
  reasoning?: string;
  toolCalls?: AiToolCall[];
} {
  const completion = event.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
  const reasoning = event.content
    .filter((part) => part.type === 'reasoning')
    .map((part) => part.text)
    .join('');
  const toolCalls = event.content
    .filter((part) => part.type === 'tool-call')
    .map((part) => {
      const input = captureValue(part.input, 'toolArguments', { tool: part.toolName });
      return {
        id: part.toolCallId,
        name: part.toolName,
        ...(input !== undefined && { input }),
        origin: originOf(part.toolName, part.providerExecuted === true, mcpTools),
      } satisfies AiToolCall;
    });

  const capturedCompletion = captureText(completion, 'completion');
  const capturedReasoning = captureText(reasoning, 'reasoning');
  return {
    ...(capturedCompletion !== undefined && { completion: capturedCompletion }),
    ...(capturedReasoning !== undefined && { reasoning: capturedReasoning }),
    ...(toolCalls.length > 0 && { toolCalls }),
  };
}

/**
 * Who ran this generation, from the two things that can say so: the frame `profileAgent` opened
 * around the call, which knows the agent's name, and the marker the SDK writes into the outgoing
 * user-agent, which knows an agent ran at all. Either alone is worth recording — an unwrapped
 * `ToolLoopAgent` still reads as a tool loop, and a hand-rolled loop the host named still reads
 * as itself.
 */
function agentOf(headers: unknown): AiAgentInfo | undefined {
  const named = currentAiAgent();
  const framework = agentFrameworkOf(headers);
  if (named === undefined && framework === undefined) return undefined;
  return {
    ...(named?.id !== undefined && { id: named.id }),
    ...(named?.name !== undefined && { name: named.name }),
    ...(framework !== undefined && { framework }),
  };
}

/** Folds the operation's tool choice into the call's own settings, which do not carry it. */
function withToolChoice(
  settings: AiCallSettings | undefined,
  toolChoice: string | undefined,
): AiCallSettings | undefined {
  if (toolChoice === undefined) return settings;
  return { ...settings, toolChoice };
}

/**
 * Records every AI SDK language-model call and tool execution into the active profile.
 *
 * Registered once with `registerTelemetry()`, which is what makes it non-intrusive: no call site
 * passes it anything and no model is wrapped, yet every `generateText` / `streamText` /
 * `generateObject` in the process is captured — including, for a stream, the figures that only
 * exist once the last token is out.
 */
export class AiProfilerTelemetry implements Telemetry {
  private readonly pendingCalls = new Map<string, PendingCall>();
  private readonly pendingTools = new Map<string, number>();
  /** The `generateText` / `streamText` invocation each call id belongs to. */
  private readonly operations = new Map<string, Operation>();

  onStart: Telemetry['onStart'] = (event) => {
    const toolChoice = toolChoiceOf(event);
    const raw = event as unknown as Record<string, unknown>;
    const settings = settingsOf(event);
    const instructions = toInstructions(raw['system']);
    const messages = operationMessages(raw);
    const outputSchema = captureSchema(raw['schema'], 'output');
    // What the application threads through the whole generation — off unless the host asked.
    const context = captureValue(raw['runtimeContext'], 'runtimeContext');
    // Read here and nowhere else: the start event is the only one carrying the tool objects
    // themselves, and a tool object is the only thing that still knows it came from a server.
    const mcpTools = mcpToolNamesOf(raw['tools']);
    const agent = agentOf(raw['headers']);
    this.operations.set(event.callId, {
      id: event.operationId,
      startedAt: Date.now(),
      steps: 0,
      ...(context !== undefined && { context }),
      ...(mcpTools.size > 0 && { mcpTools }),
      ...(agent !== undefined && { agent }),
      ...(typeof raw['provider'] === 'string' && { provider: raw['provider'] }),
      ...(typeof raw['modelId'] === 'string' && { model: raw['modelId'] }),
      ...(instructions !== undefined && { instructions }),
      ...(messages !== undefined && { messages }),
      ...(settings !== undefined && { settings }),
      ...(toolChoice !== undefined && { toolChoice }),
      ...(typeof raw['output'] === 'string' && { outputStrategy: raw['output'] }),
      ...(outputSchema !== undefined && { outputSchema }),
      ...(typeof raw['schemaName'] === 'string' && { schemaName: raw['schemaName'] }),
    });
  };

  /**
   * Folds what only the finished operation knows into its last model call: the object
   * `generateObject` parsed, and the warnings the provider raised along the way.
   */
  onEnd: Telemetry['onEnd'] = (event) => {
    const operation = this.operations.get(event.callId);
    this.operations.delete(event.callId);
    if (!operation) return;

    const raw = event as unknown as Record<string, unknown>;
    // `generateObject` (and embeddings, and reranking) emit no model-call events, so nothing has
    // been recorded yet — the operation itself is the only call there was.
    const call = operation.lastCall ?? this.synthesize(operation, raw);
    if (!call) return;

    if (raw['object'] !== undefined) {
      const output = captureValue(raw['object'], 'output');
      if (output !== undefined) call.output = output;
    }
    const approvals = approvalsOf(raw['content']);
    if (approvals !== undefined) call.approvals = approvals;
    const reasoning = raw['reasoning'];
    if (typeof reasoning === 'string') {
      const captured = captureText(reasoning, 'reasoning');
      if (captured !== undefined) call.reasoning = captured;
    }
    const warnings = Array.isArray(raw['warnings']) ? raw['warnings'] : [];
    if (warnings.length > 0) {
      call.warnings = warnings.map((warning) => captureDiagnostic(describeWarning(warning)));
    }
  };

  /** Builds the call entry an operation without model-call events never produced, and records it. */
  private synthesize(operation: Operation, raw: Record<string, unknown>): AiCallEntry | undefined {
    const usage = isRecord(raw['usage']) ? raw['usage'] : undefined;
    const flat = usage !== undefined ? flatUsage(usage) : undefined;
    const provider = operation.provider ?? 'unknown';
    const model = operation.model ?? 'unknown';
    const entry: AiCallEntry = {
      kind: 'call',
      callId: typeof raw['callId'] === 'string' ? raw['callId'] : '',
      step: 0,
      operation: operation.id,
      provider,
      model,
      duration: Math.max(0, Date.now() - operation.startedAt),
      startedAt: operation.startedAt,
      ...(operation.instructions !== undefined && { instructions: operation.instructions }),
      ...(operation.messages !== undefined && { messages: operation.messages }),
      ...(operation.settings !== undefined && { settings: operation.settings }),
      ...(operation.context !== undefined && { context: operation.context }),
      ...(operation.agent !== undefined && { agent: operation.agent }),
      ...(operation.outputStrategy !== undefined && { outputStrategy: operation.outputStrategy }),
      ...(operation.outputSchema !== undefined && { outputSchema: operation.outputSchema }),
      ...(operation.schemaName !== undefined && { schemaName: operation.schemaName }),
      ...(flat !== undefined && { usage: flat }),
      ...priceOf(
        isRecord(raw['providerMetadata'])
          ? (raw['providerMetadata'] as ProviderMetadata)
          : undefined,
        flat,
        provider,
        model,
      ),
      ...(typeof raw['finishReason'] === 'string' && { finishReason: raw['finishReason'] }),
      fingerprint: `${provider}:${model}`,
    };
    this.record(entry);
    return entry;
  }

  onLanguageModelCallStart: Telemetry['onLanguageModelCallStart'] = (event) => {
    const instructions = instructionsOf(event);
    const messages = messagesOf(event);
    const tools = toolsOf(event, this.operations.get(event.callId)?.mcpTools);
    const settings = settingsOf(event);
    this.pendingCalls.set(event.callId, {
      startedAt: Date.now(),
      ...(instructions !== undefined && { instructions }),
      ...(messages !== undefined && { messages }),
      ...(tools !== undefined && { tools }),
      ...(settings !== undefined && { settings }),
    });
  };

  onLanguageModelCallEnd: Telemetry['onLanguageModelCallEnd'] = (event) => {
    const pending = this.pendingCalls.get(event.callId);
    this.pendingCalls.delete(event.callId);
    const operation = this.operations.get(event.callId);
    const step = operation?.steps ?? 0;
    if (operation) operation.steps = step + 1;
    const settings = withToolChoice(pending?.settings, operation?.toolChoice);

    const { performance } = event;
    this.record({
      kind: 'call',
      callId: event.callId,
      step,
      operation: operation?.id ?? 'ai.languageModelCall',
      provider: event.provider,
      model: event.modelId,
      duration: Math.round(performance.responseTimeMs * 1000) / 1000,
      startedAt: pending?.startedAt ?? Date.now() - performance.responseTimeMs,
      ...(performance.timeToFirstOutputMs !== undefined && {
        timeToFirstOutput: Math.round(performance.timeToFirstOutputMs),
      }),
      ...(performance.outputTokensPerSecond !== undefined && {
        outputTokensPerSecond: Math.round(performance.outputTokensPerSecond * 10) / 10,
      }),
      ...(usageOf(event) !== undefined && { usage: usageOf(event) }),
      ...priceOf(
        event.providerMetadata,
        usageOf(event),
        event.provider,
        event.modelId,
        operation?.model,
      ),
      finishReason: event.finishReason,
      ...(event.responseId !== '' && { responseId: event.responseId }),
      ...(pending?.instructions !== undefined && { instructions: pending.instructions }),
      ...(pending?.messages !== undefined && { messages: pending.messages }),
      ...(pending?.tools !== undefined && { tools: pending.tools }),
      ...(settings !== undefined && { settings }),
      ...(operation?.context !== undefined && { context: operation.context }),
      ...(operation?.agent !== undefined && { agent: operation.agent }),
      ...contentOf(event, operation?.mcpTools),
      ...(operation?.outputStrategy !== undefined && { outputStrategy: operation.outputStrategy }),
      ...(operation?.outputSchema !== undefined && { outputSchema: operation.outputSchema }),
      ...(operation?.schemaName !== undefined && { schemaName: operation.schemaName }),
      fingerprint: `${event.provider}:${event.modelId}`,
    });
  };

  onToolExecutionStart: Telemetry['onToolExecutionStart'] = (event) => {
    this.pendingTools.set(event.toolCall.toolCallId, Date.now());
  };

  onToolExecutionEnd: Telemetry['onToolExecutionEnd'] = (event) => {
    const { toolCall, toolOutput } = event;
    const startedAt = this.pendingTools.get(toolCall.toolCallId);
    this.pendingTools.delete(toolCall.toolCallId);
    const operation = this.operations.get(event.callId);
    // What the application handed its tools for this run — off unless the host asked for it.
    const context = captureValue(event.toolContext, 'runtimeContext', {
      tool: toolCall.toolName,
    });

    const entry: AiToolExecutionEntry = {
      kind: 'tool',
      callId: event.callId,
      name: toolCall.toolName,
      toolCallId: toolCall.toolCallId,
      duration: Math.round(event.toolExecutionMs * 1000) / 1000,
      startedAt: startedAt ?? Date.now() - event.toolExecutionMs,
      input: captureValue(toolCall.input, 'toolArguments', { tool: toolCall.toolName }),
      origin: originOf(toolCall.toolName, toolCall.providerExecuted === true, operation?.mcpTools),
      ...(context !== undefined && { context }),
      ...(operation?.agent !== undefined && { agent: operation.agent }),
      fingerprint: `tool:${toolCall.toolName}`,
      ...(toolOutput.type === 'tool-error'
        ? { error: captureDiagnostic(String((toolOutput as { error?: unknown }).error)) }
        : {
            output: captureValue((toolOutput as { output?: unknown }).output, 'toolResults', {
              tool: toolCall.toolName,
            }),
          }),
    };
    this.record(entry);
  };

  /**
   * The SDK reports a failure as `{ callId, error }` and emits no call-end event for it, so this
   * is the only trace a failed call leaves — the operation it belonged to still holds the prompt
   * and the model, which is exactly what makes the failure readable.
   */
  onError: Telemetry['onError'] = (event) => {
    const raw = isRecord(event) ? event : {};
    const callId = typeof raw['callId'] === 'string' ? raw['callId'] : 'unknown';
    const cause = 'error' in raw ? raw['error'] : event;
    const operation = this.operations.get(callId);
    const pending = this.pendingCalls.get(callId);
    this.pendingCalls.delete(callId);
    const startedAt = pending?.startedAt ?? operation?.startedAt ?? Date.now();
    const instructions = pending?.instructions ?? operation?.instructions;
    const messages = pending?.messages ?? operation?.messages;
    const settings = pending?.settings ?? operation?.settings;
    this.record({
      kind: 'call',
      callId,
      step: operation?.steps ?? 0,
      operation: operation?.id ?? 'ai.languageModelCall',
      provider: operation?.provider ?? 'unknown',
      model: operation?.model ?? 'unknown',
      duration: Math.max(0, Date.now() - startedAt),
      startedAt,
      ...(instructions !== undefined && { instructions }),
      ...(messages !== undefined && { messages }),
      ...(pending?.tools !== undefined && { tools: pending.tools }),
      ...(settings !== undefined && { settings }),
      ...(operation?.context !== undefined && { context: operation.context }),
      ...(operation?.agent !== undefined && { agent: operation.agent }),
      error: captureDiagnostic(describeError(cause)),
    });
  };

  private record(entry: AiEntry): void {
    const profile = readProfile(ClsServiceManager.getClsService());
    if (!profile) return;
    // An HTTP request that called a model is an AI generation first: promote it so it lands in
    // the AI list rather than among the plain requests. Other kinds (a CLI command, a consumed
    // message) keep theirs — they belong in their own list, model call or not.
    if (promoteEntrypoint && profile.entrypoint.type === HTTP_ENTRYPOINT_TYPE) {
      profile.entrypoint.type = AI_ENTRYPOINT_TYPE;
    }
    appendCollectorEntry<AiEntry>(profile, AI_ENTRIES_KEY, entry);
    if (entry.kind === 'call') {
      const operation = this.operations.get(entry.callId);
      if (operation) operation.lastCall = entry;
    }
  }
}

export type { AiCallEntry };
