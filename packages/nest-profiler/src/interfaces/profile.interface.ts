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
  /**
   * Machine-readable error code, when the protocol carries one distinct from the class
   * name — a GraphQL `extensions.code` (`BAD_USER_INPUT`, `INTERNAL_SERVER_ERROR`…). It is
   * what the error classification and the `exception` list filter key on in preference to
   * {@link name}, which GraphQL flattens to `GraphQLError` for every error alike.
   */
  code?: string;
  stack?: string;
  /**
   * The error this one wraps — `new Error('...', { cause })`, the standard way a layered
   * application reports a failure. Recorded recursively (bounded depth, cycle-safe), because the
   * cause is usually what actually went wrong: an `InternalServerErrorException` says nothing,
   * the `QueryFailedError` underneath it says everything.
   */
  cause?: ExceptionEntry;
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
  /** Epoch milliseconds at which the profiled work started — an absolute instant, for display. */
  startTime: number;
  /**
   * Wall-clock milliseconds the profiled work took, measured on a **monotonic** clock and
   * carrying up to three decimals. Fractional by design: sub-millisecond work is real work, and
   * a duration rounded to `0` cannot be compared with anything. Format it for display with the
   * `formatDuration` view helper rather than printing it raw.
   */
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
  /** Epoch milliseconds the span started, used to place it against {@link PerformanceData.startTime}. */
  startedAt: number;
  /** Monotonic milliseconds the span took, with up to three decimals (see {@link PerformanceData.duration}). */
  duration: number;
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
  security?: SecurityContext;
  /**
   * Performance tags aggregated by the rule engine ({@link analyzeProfile}) from
   * the collected entries and the profile itself — the deduplicated set surfaced
   * in the profile header, the list-page pills and the `tags` list filter.
   */
  tags?: ProfilerTag[];
}
