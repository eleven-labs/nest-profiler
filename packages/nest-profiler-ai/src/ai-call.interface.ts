import type { ProfilerTag } from '@eleven-labs/nest-profiler';
import type { AiAgentInfo } from './ai-agent';
import type { AiCaptureField, AiCaptureLevel } from './ai-capture';

/** Key the raw entries are accumulated under, before {@link AiCollector} shapes them. */
export const AI_ENTRIES_KEY = 'ai.entries';

export type AiMessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** A message part that is not plain text — a tool call, a tool result, an attachment. */
export interface AiMessagePart {
  type: string;
  /** Whatever names the part: a tool name, a file name. */
  name?: string;
  /** Attachments: the declared IANA media type. */
  mediaType?: string;
  /** Attachments carried inline: how much data was sent, which is never itself recorded. */
  bytes?: number;
  /** Attachments carried by reference: where the model was pointed at. */
  url?: string;
  value?: unknown;
}

/**
 * A human-in-the-loop decision on one tool call: the model asked, and someone answered — or has
 * not yet. `requested` is what the first half of the exchange leaves behind.
 */
export interface AiApproval {
  approvalId: string;
  tool: string;
  decision: 'requested' | 'approved' | 'denied';
  reason?: string;
  /** `true` when the SDK decided by policy rather than a person. */
  automatic?: boolean;
}

/** One message of the conversation as it was sent to the model. */
export interface AiMessage {
  role: AiMessageRole;
  text?: string;
  parts?: AiMessagePart[];
}

/**
 * Where a tool comes from, which decides who runs it and what a reader can assume about it:
 * `local` is declared in this application's code, `mcp` was discovered on an MCP server at
 * runtime, and `provider` is built into the model itself (a provider-run web search, say) and
 * never executes here at all.
 */
export type AiToolOrigin = 'local' | 'mcp' | 'provider';

/** A tool as it was declared to the model, with the schema the model had to fill. */
export interface AiToolDefinition {
  name: string;
  origin: AiToolOrigin;
  description?: string;
  inputSchema?: unknown;
}

/** A tool the model asked for. Its execution is recorded separately, if it ran. */
export interface AiToolCall {
  id?: string;
  name: string;
  input?: unknown;
  origin: AiToolOrigin;
}

/** The sampling settings the call was made with — what a reproduction would need. */
export interface AiCallSettings {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  seed?: number;
  stopSequences?: string[];
  toolChoice?: string;
  responseFormat?: string;
}

export interface AiTokenUsage {
  input?: number;
  /** Input tokens read from the prompt cache; already counted in `input`. */
  cacheRead?: number;
  /** Input tokens written to the prompt cache; already counted in `input`. */
  cacheWrite?: number;
  output?: number;
  /** Thinking tokens; already counted in `output`. */
  reasoning?: number;
  total?: number;
}

/** What both entry kinds share, so the trace and the rule engine read them alike. */
interface AiEntryBase {
  /** Correlates every entry produced by one `generateText` / `streamText` invocation. */
  callId: string;
  duration: number;
  startedAt: number;
  error?: string;
  /**
   * The agent this entry belongs to, when an AI SDK `Agent` drove the generation rather than a
   * bare `generateText` / `streamText` call. Named only where the application wrapped its agent
   * with `profileAgent`; otherwise it carries the loop's framework alone.
   */
  agent?: AiAgentInfo;
  /** Stamped by `appendCollectorEntry` so the entry nests under the span that issued it. */
  parentSpanId?: string;
  fingerprint?: string;
  /** Populated by the profiler's performance-rule engine. */
  tags?: ProfilerTag[];
}

/** One provider round-trip. A tool loop makes several, distinguished by {@link step}. */
export interface AiCallEntry extends AiEntryBase {
  kind: 'call';
  /** AI SDK operation that issued the call: `ai.generateText`, `ai.streamText`, … */
  operation: string;
  provider: string;
  model: string;
  /** Zero-based index of this call within its operation. */
  step: number;
  /** System instructions, which the SDK keeps apart from the conversation. */
  instructions?: string;
  messages?: AiMessage[];
  tools?: AiToolDefinition[];
  settings?: AiCallSettings;
  /** ms until the model's first output chunk; streaming calls only. */
  timeToFirstOutput?: number;
  /** Output tokens per second after the first chunk; streaming calls only. */
  outputTokensPerSecond?: number;
  usage?: AiTokenUsage;
  /**
   * What the call cost: the figure the provider reported, or one worked out from the tokens and
   * the prices the module was configured with. Absent when neither is available — which is not
   * the same as free, and the panel says so.
   */
  cost?: number;
  /** Where {@link AiCallEntry.cost} came from. */
  costSource?: 'provider' | 'estimated';
  finishReason?: string;
  responseId?: string;
  completion?: string;
  /** The model's thinking, when it exposed any. */
  reasoning?: string;
  /**
   * The runtime context the application threaded through this generation — the AI SDK's
   * `runtimeContext`, as the operation started. Recorded only where `capture.runtimeContext`
   * asks for it: it is the application's own state (the user, the tenant, a token) rather than
   * anything the model said.
   */
  context?: unknown;
  toolCalls?: AiToolCall[];
  /** Approval requests and responses exchanged over this call's tool calls. */
  approvals?: AiApproval[];
  /** `generateObject` only: the output strategy, its JSON Schema and the object that came back. */
  output?: unknown;
  outputSchema?: unknown;
  schemaName?: string;
  outputStrategy?: string;
  warnings?: string[];
}

/** One tool the SDK ran between two model calls — real time, spent outside the model. */
export interface AiToolExecutionEntry extends AiEntryBase {
  kind: 'tool';
  name: string;
  toolCallId: string;
  input?: unknown;
  output?: unknown;
  origin: AiToolOrigin;
  /**
   * The context this tool was handed — the AI SDK's `toolContext`. Recorded only where
   * `capture.runtimeContext` asks for it, since it holds the application's own runtime state
   * (the user, the tenant, a token) rather than anything the model said.
   */
  context?: unknown;
}

export type AiEntry = AiCallEntry | AiToolExecutionEntry;

export const isAiCall = (entry: AiEntry): entry is AiCallEntry => entry.kind === 'call';

/** What {@link AiCollector} exposes to its panel. */
export interface AiCollectorData {
  /** Model calls and tool executions in the order they happened. */
  entries: AiEntry[];
  callCount: number;
  toolCount: number;
  totalTokens: number;
  totalCost: number;
  /** Whether any call priced at all — without it `totalCost` means unknown, not free. */
  costKnown: boolean;
  /** Whether any of the cost was worked out from token prices rather than reported. */
  costEstimated: boolean;
  /** Sum of every model response time — not the request duration, which includes the rest. */
  totalDuration: number;
  /** Sum of every tool execution time. */
  toolDuration: number;
  /**
   * The capture level each content field was recorded at. Stored on the profile rather than read
   * from the configuration when the panel renders: a profile is read long after it was taken,
   * often on another machine, and a reader must be able to tell a model that said nothing from a
   * completion that was never recorded.
   */
  capture?: Record<AiCaptureField, AiCaptureLevel>;
}
