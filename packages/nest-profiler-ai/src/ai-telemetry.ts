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
import { isMcpTool } from './mcp-tool-registry';
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

/** Defaults for the bounds applied before anything reaches a stored profile. */
const DEFAULT_MAX_TEXT_LENGTH = 2000;
const DEFAULT_MAX_MESSAGES = 40;

/** What the capture functions need from the module options, resolved once. */
interface CaptureConfig {
  captureContent: boolean;
  maxTextLength: number;
  maxMessages: number;
}

let config: CaptureConfig = {
  captureContent: true,
  maxTextLength: DEFAULT_MAX_TEXT_LENGTH,
  maxMessages: DEFAULT_MAX_MESSAGES,
};

/**
 * Applies the module's capture settings.
 *
 * Module-scoped rather than threaded through every helper: the telemetry integration is a
 * process-wide singleton (`registerTelemetry` is), so there is exactly one configuration to hold.
 */
export function configureAiCapture(next: Partial<CaptureConfig>): void {
  config = { ...config, ...next };
}

/** Whether a profiled HTTP request that called a model is promoted to the `ai` kind. */
let promoteEntrypoint = true;

export function configureAiEntrypointPromotion(enabled: boolean): void {
  promoteEntrypoint = enabled;
}

interface Operation {
  id: string;
  startedAt: number;
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

function truncate(text: string): string {
  const max = config.maxTextLength;
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** Content the host asked not to record is dropped here, once, rather than at every call site. */
function content<T>(value: T): T | undefined {
  return config.captureContent ? value : undefined;
}

/** Keeps an arbitrary payload (a tool input, a tool result) inside a bounded size. */
function boundValue(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') return truncate(value);
  try {
    const max = config.maxTextLength * 2;
    const json = JSON.stringify(value);
    return json !== undefined && json.length > max ? `${json.slice(0, max)}…` : value;
  } catch {
    return '[unserializable]';
  }
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

  const describe = (value: unknown): AiMessagePart | undefined => {
    // Structural rather than `instanceof URL`: the URL may come from another realm.
    if (isRecord(value) && typeof value['href'] === 'string') {
      return { ...described, url: value['href'] };
    }
    if (typeof value === 'string') {
      return value.startsWith('http') || value.startsWith('data:')
        ? { ...described, url: value.slice(0, 200), bytes: value.length }
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
  return describe(data) ?? describe(tagged) ?? { ...described, value: boundValue(tagged ?? data) };
}

/** A tool result travels as `{ type: 'json', value }`; the panel wants the value, not the envelope. */
function unwrapToolOutput(value: unknown): unknown {
  return isRecord(value) && 'value' in value && typeof value['type'] === 'string'
    ? value['value']
    : value;
}

/** Splits a message's content into the text a panel shows and the parts it lists separately. */
function toMessage(message: ModelMessage): AiMessage {
  if (typeof message.content === 'string') {
    return { role: message.role, text: truncate(message.content) };
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
    parts.push({
      type: part.type,
      ...(typeof name === 'string' && { name }),
      value: boundValue(value),
    });
  }

  return {
    role: message.role,
    ...(texts.length > 0 && { text: truncate(texts.join('')) }),
    ...(parts.length > 0 && { parts }),
  };
}

function toMessages(messages: readonly ModelMessage[]): AiMessage[] | undefined {
  if (!config.captureContent) return undefined;
  const mapped = messages.slice(-config.maxMessages).map(toMessage);
  return mapped.length > 0 ? mapped : undefined;
}

function messagesOf(event: LanguageModelCallStartEvent): AiMessage[] | undefined {
  return toMessages(event.messages);
}

function toInstructions(instructions: unknown): string | undefined {
  if (instructions === undefined || instructions === null || !config.captureContent) {
    return undefined;
  }
  const list = Array.isArray(instructions) ? instructions : [instructions];
  const text = list
    .map((item: unknown) =>
      typeof item === 'string' ? item : String(isRecord(item) ? item['content'] : ''),
    )
    .filter((item) => item !== '')
    .join('\n');
  return text === '' ? undefined : truncate(text);
}

/** The conversation an operation-level start event carries, under whichever field it used. */
function operationMessages(raw: Record<string, unknown>): AiMessage[] | undefined {
  const messages = raw['messages'];
  if (Array.isArray(messages)) return toMessages(messages as ModelMessage[]);
  const prompt = raw['prompt'];
  if (Array.isArray(prompt)) return toMessages(prompt as ModelMessage[]);
  if (typeof prompt === 'string') return [{ role: 'user', text: truncate(prompt) }];
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
function originOf(name: string, providerDefined = false): AiToolOrigin {
  if (providerDefined) return 'provider';
  return isMcpTool(name) ? 'mcp' : 'local';
}

/** The tools as the provider received them — name, origin, description and the input schema. */
function toolsOf(event: LanguageModelCallStartEvent): AiToolDefinition[] | undefined {
  const tools = event.tools?.filter(isRecord).map((tool) => {
    const name = typeof tool['name'] === 'string' ? tool['name'] : 'unknown';
    return {
      name,
      origin: originOf(name, tool['type'] === 'provider-defined'),
      ...(typeof tool['description'] === 'string' && { description: tool['description'] }),
      ...(tool['inputSchema'] !== undefined && { inputSchema: tool['inputSchema'] }),
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
 */
function priceOf(
  metadata: ProviderMetadata | undefined,
  usage: AiTokenUsage | undefined,
  provider: string,
  model: string,
): Pick<AiCallEntry, 'cost' | 'costSource'> {
  const reported = costOf(metadata);
  if (reported !== undefined) return { cost: reported, costSource: 'provider' };
  const estimated = estimateCost(usage, provider, model);
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
    approvals.push({
      approvalId: typeof raw['approvalId'] === 'string' ? raw['approvalId'] : '',
      tool: typeof toolCall['toolName'] === 'string' ? toolCall['toolName'] : 'unknown',
      decision:
        raw['type'] === 'tool-approval-request' ? 'requested' : approved ? 'approved' : 'denied',
      ...(typeof raw['reason'] === 'string' && { reason: raw['reason'] }),
      ...(raw['isAutomatic'] === true && { automatic: true }),
    });
  }
  return approvals.length > 0 ? approvals : undefined;
}

function contentOf(event: LanguageModelCallEndEvent): {
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
    .map(
      (part) =>
        ({
          id: part.toolCallId,
          name: part.toolName,
          input: boundValue(part.input),
          origin: originOf(part.toolName, part.providerExecuted === true),
        }) satisfies AiToolCall,
    );

  return {
    ...(completion !== '' && content({ completion: truncate(completion) })),
    ...(reasoning !== '' && content({ reasoning: truncate(reasoning) })),
    ...(toolCalls.length > 0 && { toolCalls }),
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
    this.operations.set(event.callId, {
      id: event.operationId,
      startedAt: Date.now(),
      steps: 0,
      ...(typeof raw['provider'] === 'string' && { provider: raw['provider'] }),
      ...(typeof raw['modelId'] === 'string' && { model: raw['modelId'] }),
      ...(instructions !== undefined && { instructions }),
      ...(messages !== undefined && { messages }),
      ...(settings !== undefined && { settings }),
      ...(toolChoice !== undefined && { toolChoice }),
      ...(typeof raw['output'] === 'string' && { outputStrategy: raw['output'] }),
      ...(raw['schema'] !== undefined && { outputSchema: raw['schema'] }),
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

    if (raw['object'] !== undefined) call.output = content(boundValue(raw['object']));
    const approvals = approvalsOf(raw['content']);
    if (approvals !== undefined) call.approvals = approvals;
    const reasoning = raw['reasoning'];
    if (typeof reasoning === 'string' && reasoning !== '' && config.captureContent) {
      call.reasoning = truncate(reasoning);
    }
    const warnings = Array.isArray(raw['warnings']) ? raw['warnings'] : [];
    if (warnings.length > 0) {
      call.warnings = warnings.map((warning) => truncate(describeWarning(warning)));
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
    const tools = toolsOf(event);
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
      ...priceOf(event.providerMetadata, usageOf(event), event.provider, event.modelId),
      finishReason: event.finishReason,
      ...(event.responseId !== '' && { responseId: event.responseId }),
      ...(pending?.instructions !== undefined && { instructions: pending.instructions }),
      ...(pending?.messages !== undefined && { messages: pending.messages }),
      ...(pending?.tools !== undefined && { tools: pending.tools }),
      ...(settings !== undefined && { settings }),
      ...contentOf(event),
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

    const entry: AiToolExecutionEntry = {
      kind: 'tool',
      callId: event.callId,
      name: toolCall.toolName,
      toolCallId: toolCall.toolCallId,
      duration: Math.round(event.toolExecutionMs * 1000) / 1000,
      startedAt: startedAt ?? Date.now() - event.toolExecutionMs,
      input: content(boundValue(toolCall.input)),
      origin: originOf(toolCall.toolName, toolCall.providerExecuted === true),
      fingerprint: `tool:${toolCall.toolName}`,
      ...(toolOutput.type === 'tool-error'
        ? { error: String((toolOutput as { error?: unknown }).error) }
        : { output: content(boundValue((toolOutput as { output?: unknown }).output)) }),
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
      error: describeError(cause),
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
