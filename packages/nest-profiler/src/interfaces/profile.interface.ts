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
  /** Id of the GraphQL field span this phase ran under, when opened inside one. */
  parentSpanId?: string;
}

/**
 * Category of a {@link TraceSpan}, used to colour the waterfall. An open string
 * union so protocol packages can contribute their own kinds without a core change.
 */
export type TraceSpanKind = 'entrypoint' | 'phase' | 'http' | 'db' | 'graphql-field' | 'custom';

export type TraceSpanStatus = 'ok' | 'error';

/**
 * One node of the unified trace assembled by `buildTrace`. Unlike the flat
 * {@link TimelineSpan}, spans carry an `id`/`parentId` so the Timeline panel renders
 * them as a nested waterfall merging every timed operation on one axis. Stored flat
 * and `parentId`-linked on {@link Profile.trace}; the UI rebuilds the tree at render.
 */
export interface TraceSpan {
  id: string;
  /** `undefined` only for the root; every other span reparents to the root at worst. */
  parentId?: string;
  kind: TraceSpanKind;
  label: string;
  /** Epoch ms (wall clock), same basis as {@link PerformanceData.startTime}. */
  startedAt: number;
  duration: number;
  status?: TraceSpanStatus;
  /**
   * Back-reference to the collector entry. `tab` is the detail panel to open (the
   * collector's group when it is grouped, e.g. `database`, else its own name).
   */
  source?: { collector: string; index?: number; tab?: string };
  /** Performance tags carried by the underlying entry (slow, N+1…), surfaced on the bar. */
  tags?: ProfilerTag[];
  /** Display-only extras (statusCode, query type, rowCount…). */
  meta?: Record<string, string | number | boolean>;
}

/**
 * One phase of the request lifecycle (guards, validation, controller…), captured as a flat,
 * non-nested bar on the request's time axis — a Symfony-profiler-style breakdown rendered above
 * the causal waterfall, so it never competes with the trace's containment nesting.
 */
export interface LifecyclePhase {
  name: string;
  /** Epoch ms, same basis as {@link PerformanceData.startTime}. */
  startedAt: number;
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
  /**
   * The merged, causally-nested span tree for the unified waterfall, assembled once
   * after {@link collectAll} by `buildTrace` (see the Timeline panel). Flat and
   * `parentId`-linked so it serializes cleanly into the stored profile.
   */
  trace?: TraceSpan[];
  security?: SecurityContext;
  /** Flat request-lifecycle phases (guards, validation, controller), assembled by `buildLifecycle`. */
  lifecycle?: LifecyclePhase[];
  /**
   * Performance tags aggregated by the rule engine ({@link analyzeProfile}) from
   * the collected entries and the profile itself — the deduplicated set surfaced
   * in the profile header, the list-page pills and the `tags` list filter.
   */
  tags?: ProfilerTag[];
}
