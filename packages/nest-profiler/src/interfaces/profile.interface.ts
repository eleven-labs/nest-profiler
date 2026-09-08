import type { ProfilerTag } from '../analysis/profiler-tag.interface';
import type { SourceCodeFrame } from '../utils/source-context.util';
import type { SummaryPrimitive } from '../storage/profile-summary';

export type LogLevel = 'log' | 'warn' | 'error' | 'debug' | 'verbose' | 'fatal';

export interface LogEntry {
  level: LogLevel;
  message: string;
  /** Logger context name, e.g. the class name passed to `new Logger(...)` or `setContext()`. */
  context?: string;
  /** Structured payload captured from the log call (leading merge object, trailing object, extra args), made JSON-safe. */
  data?: unknown;
  /**
   * Id of the {@link TraceSpan} that was open when the line was written, so the waterfall can
   * show the line at its place in the tree rather than in a flat list beside it. Set by
   * `createProfilerLogger` from the active span in the CLS store; absent for a line written
   * outside any span (during bootstrap, or straight from the entrypoint).
   */
  spanId?: string;
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
  /**
   * Source-code excerpts around this exception's application stack frames — the Symfony
   * exception page, locally. Present only when {@link ProfilerModuleOptions.sourceContext} is
   * enabled and at least one frame resolved to a readable application file.
   */
  frames?: SourceCodeFrame[];
  /**
   * `true` when the application caught this error itself and reported it through
   * `TracerService.captureError()` — a degraded call, a retry, a deliberate fallback.
   *
   * The distinction is not cosmetic: an unhandled exception means the entrypoint failed, a
   * handled one means it did not. Error classification, the `exception` list filter and the
   * `error` performance tag all key on the unhandled ones, so a request that recovered and
   * answered 200 is not filed as a failure.
   */
  handled?: boolean;
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
  /**
   * CPU time the process consumed while this profile was open, in milliseconds.
   *
   * The signal the duration alone cannot give: compared against {@link duration}, it separates
   * work that was *computing* from work that was *waiting*. A ratio near 1 is CPU-bound, near 0
   * is I/O-bound — and a slow endpoint is fixed very differently in the two cases.
   *
   * Process-wide over the profile's window (see {@link ProfilerRuntimeOptions}), so under
   * concurrent traffic it includes what neighbouring requests spent. Absent for a profile whose
   * start was never marked.
   */
  cpu?: {
    /** Time in user code. */
    user: number;
    /** Time in system calls. */
    system: number;
    /** `user + system` — what to read against {@link duration}. */
    total: number;
  };
  /**
   * Process memory at the end of the profile, and how much it moved while the profile was open.
   *
   * The deltas are what a leak looks like: a request that grows the heap and never gives it back.
   * They can legitimately be negative — a garbage collection during the window frees more than
   * the request allocated. Absent for a profile whose start was never marked.
   */
  memory?: {
    /** V8 heapUsed at the end of the profile (bytes). */
    heapUsedAfter: number;
    /** Change in heapUsed over the window (bytes, may be negative). */
    heapDelta: number;
    /** Resident set size at the end of the profile (bytes). */
    rss: number;
    /** Change in resident set size over the window (bytes, may be negative). */
    rssDelta: number;
    /** Memory held by C++ objects bound to V8 (buffers, sockets…) at the end (bytes). */
    external?: number;
  };
  /**
   * Event-loop utilization over the profile's window: how much of the wall clock the loop spent
   * running JavaScript rather than idle. High utilization on a slow request means the thread was
   * blocked, which is the one condition no amount of concurrency can hide.
   *
   * Absent for a profile whose start was never marked.
   */
  eventLoop?: {
    /** Fraction of the window the loop was active, `0`-`1`. */
    utilization: number;
    /** Milliseconds the loop was idle. */
    idle: number;
    /** Milliseconds the loop was active. */
    active: number;
  };
  /**
   * Garbage collections that ran while the profile was open, and what they cost.
   *
   * Explains the latency spike a duration cannot: a request that is slow only because a major
   * collection landed in the middle of it. Only reported while runtime metrics are enabled —
   * observing GC means keeping a `PerformanceObserver` alive, which is not switched on behind an
   * application's back.
   */
  gc?: {
    count: number;
    /** Total pause time in milliseconds. */
    duration: number;
  };
}

export interface RouteInfo {
  controller: string;
  handler: string;
  path: string;
  method: string;
}

/**
 * Category of a {@link TraceSpan}, used to colour the waterfall and to decide what may contain
 * what. An open string union on purpose: a protocol package contributes its own kind without a
 * core change (see `TraceContributor`).
 */
export type TraceSpanKind =
  | 'entrypoint'
  | 'phase'
  | 'http'
  | 'db'
  | 'cache'
  | 'graphql-field'
  /** One provider method call, recorded by the optional automatic instrumentation. */
  | 'method'
  | 'custom'
  | (string & {});

export type TraceSpanStatus = 'ok' | 'error';

/**
 * Where a span is drawn. `trace` is the causal waterfall; `lifecycle` is the flat
 * Symfony-style band above it (guards, validation, controller), which reports framework phases
 * that overlap the whole request and would otherwise adopt every span below them.
 *
 * A rendering concern on one model, deliberately, rather than a second parallel model — the
 * previous design had `TimelineSpan`, `LifecyclePhase` and a trace tree describing the same
 * thing three ways.
 */
export type TraceSpanLane = 'trace' | 'lifecycle';

/**
 * One node of the unified trace — the single representation of "a piece of work that took
 * time", whatever produced it: the entrypoint itself, a framework phase, an outgoing HTTP call,
 * a database query, a GraphQL field, or a `TracerService.span()` written by hand.
 *
 * Stored **flat** and linked by {@link parentId} rather than nested, so it serializes into the
 * profile without cycles and the UI rebuilds the tree at render time.
 */
export interface TraceSpan {
  id: string;
  /** `undefined` only for the root; every other span reparents to the root at worst. */
  parentId?: string;
  kind: TraceSpanKind;
  label: string;
  /** Epoch ms with sub-millisecond precision (`nowMs()`), same basis as {@link PerformanceData.startTime}. */
  startedAt: number;
  duration: number;
  status?: TraceSpanStatus;
  /** Rendering lane; defaults to `'trace'` when absent. */
  lane?: TraceSpanLane;
  /**
   * Back-reference to the collector entry this span projects, so a bar deep-links to the row
   * that holds the detail (the SQL text, the response body). `tab` is the detail panel to open
   * — the collector's group when it is grouped (e.g. `database`), else its own name.
   */
  source?: { collector: string; index?: number; tab?: string };
  /** Performance tags carried by the underlying entry (slow, N+1…), surfaced on the bar. */
  tags?: ProfilerTag[];
  /** Display-only extras (statusCode, query type, rowCount…). */
  meta?: Record<string, string | number | boolean>;
}

export interface SecurityContext {
  isAuthenticated: boolean;
  user?: Record<string, unknown>;
  roles?: string[];
  jwtClaims?: Record<string, unknown>;
}

export interface Profile<TData = unknown> {
  /**
   * Storage identity: an internal UUID, never influenced by the client, used as the profile's
   * address (`/_profiler/:token`). Kept distinct from {@link traceId} on purpose — a token
   * derived from a client-supplied header could be forged to collide with, or traverse, storage.
   */
  token: string;
  /**
   * Correlation identity: adopted from the incoming `traceIdHeader` when the caller sent one,
   * generated otherwise. This is the id that leaves the process — printed in the application's
   * logs, forwarded on outgoing calls — so that a log line in a terminal or an aggregator leads
   * back to this profile.
   *
   * Being caller-supplied, it is **untrusted input**: it is length- and charset-validated at
   * adoption, and is never used to address storage.
   */
  traceId: string;
  createdAt: number;
  /** Build/release identifier stamped from {@link ProfilerModuleOptions.version}, when set. */
  version?: string;
  /** What triggered this profile (HTTP request, command, message…). */
  entrypoint: ProfileEntrypoint<TData>;
  response?: ResponseData;
  performance: PerformanceData;
  logs: LogEntry[];
  exceptions: ExceptionEntry[];
  collectors: Record<string, unknown>;
  route?: RouteInfo;
  /**
   * The unified trace: every timed operation of this profile on one time axis, flat and linked
   * by `parentId`. Assembled by `buildTrace()` once after collection and before save.
   */
  trace?: TraceSpan[];
  security?: SecurityContext;
  /**
   * Performance tags aggregated by the rule engine ({@link analyzeProfile}) from
   * the collected entries and the profile itself — the deduplicated set surfaced
   * in the profile header, the list-page pills and the `tags` list filter.
   */
  tags?: ProfilerTag[];
  /**
   * Custom facets derived from {@link ProfilerModuleOptions.attributes} when it is a function —
   * HTTP profiles only (see the option's TSDoc). Merged into
   * {@link ProfilerCoreService.getIndexAttributes} alongside any static attributes and the
   * entrypoint kind's own facets.
   */
  attributes?: Record<string, SummaryPrimitive>;
}
