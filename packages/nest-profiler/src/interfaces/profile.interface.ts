import type { ProfilerTag } from '../analysis/profiler-tag.interface';

export type LogLevel = 'log' | 'warn' | 'error' | 'debug' | 'verbose' | 'fatal';

export interface LogEntry {
  level: LogLevel;
  message: string;
  /** Logger context name, e.g. the class name passed to `new Logger(...)` or `setContext()`. */
  context?: string;
  /** Structured payload captured from the log call (leading merge object, trailing object, extra args), made JSON-safe. */
  data?: unknown;
  timestamp: number;
}

export interface ExceptionEntry {
  name: string;
  message: string;
  stack?: string;
  timestamp: number;
}

export interface GraphQLInfo {
  operationType: 'query' | 'mutation' | 'subscription';
  operationName?: string;
  query?: string;
  variables?: Record<string, unknown>;
  fieldName: string;
}

/** `Profile.entrypoint.type` value for REST HTTP requests. */
export const HTTP_ENTRYPOINT_TYPE = 'http';

/**
 * Describes what triggered a profile — an HTTP request, a GraphQL operation, a
 * CLI command, a consumed message… Each entrypoint kind owns its own `data`
 * shape: the core ships {@link HttpRequestData} for HTTP, while protocol packages
 * (e.g. `@eleven-labs/nest-profiler-graphql`, `@eleven-labs/nest-profiler-commander`)
 * contribute their own via {@link ProfilerCoreService.registerEntrypointType} — no
 * core change needed.
 */
export interface ProfileEntrypoint<TData = unknown> {
  /** Stable discriminator, e.g. `'http'`, `'command'`, … */
  type: string;
  /** Kind-specific payload owned by the package that registered the type. */
  data: TData;
}

/**
 * Payload of the built-in `http` entrypoint — a REST HTTP request.
 * `@eleven-labs/nest-profiler-graphql` extends it for the `graphql` kind.
 */
export interface HttpRequestData {
  method: string;
  url: string;
  headers: Record<string, string | string[]>;
  query: Record<string, string | string[]>;
  ip?: string;
  body?: unknown;
  cookies?: Record<string, string>;
  session?: Record<string, unknown>;
  /**
   * The client-supplied `x-request-id` header, kept purely as a correlation attribute for
   * display. It is never used as the storage token (which is always an internal UUID) so a
   * malicious or duplicated `x-request-id` can neither collide with nor traverse storage.
   */
  requestId?: string;
  /**
   * Set when the HTTP request carried a GraphQL operation. The GraphQL package
   * reads this signal to promote the profile to the `graphql` entrypoint kind.
   */
  graphql?: GraphQLInfo;
}

export interface ResponseData {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body?: unknown;
}

export interface PerformanceData {
  startTime: number;
  duration?: number;
  /** V8 heapUsed for the entire process at the moment this request started. Not per-request allocation. */
  heapUsed: number;
}

export interface RouteInfo {
  controller: string;
  handler: string;
  path: string;
  method: string;
}

export interface TimelineSpan {
  phase: string;
  startedAt: number;
  duration: number;
}

export interface EventEntry {
  eventName: string;
  payloadSummary?: string;
  listenerCount?: number;
  timestamp: number;
}

export interface SecurityContext {
  isAuthenticated: boolean;
  user?: Record<string, unknown>;
  roles?: string[];
  jwtClaims?: Record<string, unknown>;
}

export interface Profile<TData = unknown> {
  token: string;
  createdAt: number;
  /** What triggered this profile (HTTP request, command, message…). */
  entrypoint: ProfileEntrypoint<TData>;
  response?: ResponseData;
  performance: PerformanceData;
  logs: LogEntry[];
  exceptions: ExceptionEntry[];
  collectors: Record<string, unknown>;
  route?: RouteInfo;
  spans?: TimelineSpan[];
  events?: EventEntry[];
  security?: SecurityContext;
  /**
   * Performance tags aggregated by the rule engine ({@link analyzeProfile}) from
   * the collected entries and the profile itself — the deduplicated set surfaced
   * in the profile header, the list-page pills and the `tags` list filter.
   */
  tags?: ProfilerTag[];
}
