export type LogLevel = 'log' | 'warn' | 'error' | 'debug' | 'verbose' | 'fatal';

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: string;
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

export interface CommandInfo {
  /** Command name as declared via `@Command({ name })`, e.g. `sync:posts`. */
  name: string;
  /** Positional parameters passed to the command. */
  arguments: string[];
  /** Parsed flag options passed to the command. */
  options?: Record<string, unknown>;
  /** Process exit code — `0` on success, `1` when the command threw. */
  exitCode: number;
  /** `true` when the command completed without throwing. */
  success: boolean;
}

export interface RequestData {
  method: string;
  url: string;
  headers: Record<string, string | string[]>;
  query: Record<string, string | string[]>;
  ip?: string;
  body?: unknown;
  cookies?: Record<string, string>;
  session?: Record<string, unknown>;
  graphql?: GraphQLInfo;
  /** Present when the profile describes a CLI command instead of an HTTP request. */
  command?: CommandInfo;
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

export interface Profile {
  token: string;
  createdAt: number;
  request: RequestData;
  response?: ResponseData;
  performance: PerformanceData;
  logs: LogEntry[];
  exceptions: ExceptionEntry[];
  collectors: Record<string, unknown>;
  route?: RouteInfo;
  spans?: TimelineSpan[];
  events?: EventEntry[];
  security?: SecurityContext;
}
