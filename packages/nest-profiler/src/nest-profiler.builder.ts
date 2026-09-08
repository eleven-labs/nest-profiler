import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { CanActivate, ConfigurableModuleAsyncOptions, Type } from '@nestjs/common';
import type { IProfilerStorageAdapter } from './storage/storage-adapter.interface';
import type {
  ProfilerFilterRequest,
  ProfilerForceProfileFilter,
  ProfilerRequestFilter,
} from './filters';
import type { PerformanceRule } from './analysis/performance-rule.interface';
import type { ProfilerErrorOptions } from './analysis/profiler-error';
import type { PlatformRequest, PlatformResponse } from './types/http';
import type { SafeDataOptions } from './utils/safe-data.utils';
import type { ProfilerRuntimeOptions } from './runtime/runtime-metrics.interface';
import type { ProfilerRedactionOptions } from './utils/redaction-options';
import type { SourceContextOptions } from './utils/source-context.util';
import type { ProfilerEditorName } from './views/editor-link';
import type { SummaryPrimitive } from './storage/profile-summary';

/**
 * Context handed to an {@link ProfilerAuthorize} predicate. Both the request and the
 * response are the platform-agnostic surfaces shared by the Express and Fastify adapters.
 */
export interface ProfilerAuthContext {
  /** Incoming request — read cookies, headers, session or query to make the decision. */
  request: PlatformRequest;
  /**
   * Outgoing response. Set a `WWW-Authenticate` header here before returning `false` to
   * trigger a browser Basic-auth challenge (e.g. `response.setHeader('WWW-Authenticate',
   * 'Basic realm="Profiler"')`).
   */
  response: PlatformResponse;
}

/**
 * Access-control predicate for the profiler UI/API. Return `true` to allow the request,
 * `false` to deny it (the guard then throws `401 Unauthorized`). May be async.
 */
export type ProfilerAuthorize = (context: ProfilerAuthContext) => boolean | Promise<boolean>;

/**
 * Pluggable security for the profiler UI/API. Every strategy you provide runs on each
 * profiler route (static assets under `__assets/*` are always exempt so the UI can load its
 * CSS/JS); when several are provided **all must pass**. With none provided the profiler is
 * open (local-dev default).
 *
 * Browser caveat: the UI is navigated through plain `<a>` links, which only carry the
 * credentials the browser attaches automatically — cookies, sessions and HTTP Basic auth.
 * Those propagate to every page (including the `/:token/data` export) with no extra work. A
 * bare `Authorization` header or a `?token=` query cannot ride a link click: header schemes
 * suit API/CLI clients (curl), and query schemes need {@link linkQuery} to be threaded
 * through the UI links.
 */
export interface ProfilerSecurityOptions {
  /**
   * Predicate deciding whether a request may access the profiler. Combined with
   * {@link guards} (all must pass). Resolve services through `forRootAsync` + `useFactory`
   * to close over them here.
   */
  authorize?: ProfilerAuthorize;

  /**
   * NestJS guard(s) applied to the profiler routes — a class resolved through DI (reuse an
   * existing app guard such as `JwtAuthGuard`) or a ready instance. A guard class's
   * dependencies must be resolvable from the profiler module's context (globally-provided or
   * registered as a provider). Combined with {@link authorize} (all must pass).
   */
  guards?: (Type<CanActivate> | CanActivate)[];

  /**
   * Returns a query string (e.g. `?token=abc`) appended to every link the profiler UI
   * renders — navigation, tabs, pagination and the JSON export — so a query-param credential
   * survives browser navigation. Return `''` (or omit the option) to append nothing. Not
   * needed for cookie/session/Basic auth, which the browser propagates on its own.
   */
  linkQuery?: (request: PlatformRequest) => string;
}

export interface ProfilerModuleOptions {
  /**
   * Enable the profiler. Default: `true`. Set to `false` to disable.
   *
   * This is a synchronous bootstrap decision: when `false`, only the inert
   * {@link ProfilerService} is registered (no middleware, interceptor,
   * controller, storage or collectors). The host application decides per
   * environment. (One small, documented exception reads `process.env`
   * directly: the config collector reads `NODE_ENV` for display.)
   */
  enabled?: boolean;

  /**
   * Pluggable access control for the profiler UI/API. By default the profiler is **open**
   * (no authentication) — intended for local development. Provide your own strategy to lock
   * it down: a {@link ProfilerSecurityOptions.authorize | authorize} predicate, one or more
   * NestJS {@link ProfilerSecurityOptions.guards | guards}, or both (all must pass). See
   * {@link ProfilerSecurityOptions} for the browser-navigation caveats and `linkQuery`.
   */
  security?: ProfilerSecurityOptions;

  /** Maximum number of profiles kept (LRU eviction). Default: 100. Set to `0` (or negative) for no cap. */
  maxProfiles?: number;

  /**
   * Number of profiles shown per page in each dashboard list section (HTTP,
   * GraphQL, RabbitMQ, Commands…). Each section paginates independently via a
   * `<sectionKey>_page` query param. Default: 25
   */
  listPageSize?: number;

  /** Profile TTL in seconds. Default: 3600 (1h). Set to `0` (or negative) to never expire. */
  ttl?: number;

  /** Register the module as a global NestJS module. Default: false */
  isGlobal?: boolean;

  /**
   * IANA timezone the UI renders timestamps in — `'Europe/Paris'`, `'UTC'`, `'Asia/Tokyo'`…
   * Default: the timezone the process runs in — the one `TZ` selects, or the system zone when
   * `TZ` is unset. That is what the Config panel reports.
   *
   * Profiles store epoch milliseconds and every page is rendered server-side, so an
   * application running in a UTC container shows UTC times to whoever reads the dashboard.
   * Set this to the timezone the people reading the profiler are in. The effective timezone
   * is displayed in the dashboard header, so a time is never ambiguous.
   *
   * An unknown name is ignored (a warning is logged) and the host timezone is used.
   */
  timezone?: string;

  /** Capture request and response bodies. Default: false */
  collectBody?: boolean;

  /**
   * Max serialized size (in characters) of a captured request/response body before it is
   * truncated to a small placeholder (with a preview and a pointer to the raw JSON export).
   * Keeps large payloads from bloating storage and freezing the detail page. Default: 65536.
   * Set to `0` (or negative) to disable truncation.
   */
  maxBodySize?: number;

  /**
   * Inner content caps applied to each captured request/response body **before** the
   * {@link maxBodySize} size cap. They bound the captured value regardless of `maxBodySize`:
   * - `maxStringLength` — strings longer than this are truncated (default 2048).
   * - `maxItems` — arrays / objects / Map / Set are capped to this many entries (default 64).
   * - `maxDepth` — anything nested deeper collapses to `[Object]` / `[Array]` (default 4).
   *
   * Each cap can be disabled individually with `0` (or negative). Disabling every cap here
   * **and** setting `maxBodySize: 0` captures the full body verbatim — at the cost of larger
   * stored profiles and slower detail-page rendering for big payloads.
   */
  bodyCaptureLimits?: SafeDataOptions;

  /**
   * Maximum time in milliseconds a single collector may spend in `collect()`
   * before it is abandoned. On timeout the panel stores
   * `{ error: 'timed out after <n>ms' }` and a warning is logged, so one slow or
   * hanging custom collector can never block the response (or the list page).
   * Default: `1000`. Set to `0` (or a negative value) to disable the timeout.
   */
  collectorTimeout?: number;

  /**
   * Storage backend.
   * - `'memory'` (default): in-process LRU map, cleared on restart.
   * - `'file'`: persists profiles as JSON files in `storagePath`. Survives restarts.
   */
  storageType?: 'memory' | 'file';

  /**
   * Directory for file-based storage. Only used when `storageType: 'file'`.
   * Relative paths are resolved from `process.cwd()`. Default: `.profiler`
   */
  storagePath?: string;

  /**
   * Provide a fully custom storage adapter (Redis, database, …).
   * Takes precedence over `storageType`.
   */
  storage?: IProfilerStorageAdapter;

  /** Fraction of requests to profile (0.0–1.0). Default: 1.0 */
  sampleRate?: number;

  /** Paths to skip profiling (string prefix or RegExp). Merged after the defaults (see {@link useDefaultIgnorePaths}). */
  ignorePaths?: (string | RegExp)[];

  /**
   * Apply the built-in default ignore paths (favicon, robots.txt, the Chrome
   * DevTools `/.well-known/appspecific/com.chrome.devtools.json` probe,
   * apple-touch-icon…) on top of {@link ignorePaths}. Default: `true`. Set to
   * `false` to profile those requests too.
   */
  useDefaultIgnorePaths?: boolean;

  /**
   * Unified redaction configuration — headers, cookies, query parameters and object keys in one
   * block, plus extra value `patterns` and a custom `replacement` sentinel. Applied to every
   * core capture path: request and response headers, cookies, the query string, captured bodies
   * and session data. Merged additively with the deprecated flat options below when both are
   * set. See [Redacting sensitive
   * data](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#redacting-sensitive-data).
   */
  redaction?: ProfilerRedactionOptions;

  /**
   * Cookie names whose value should be replaced with '***'.
   *
   * @deprecated Use {@link redaction}'s `cookies` instead. Kept functional (merged additively
   * with `redaction.cookies`) for one release cycle.
   */
  maskCookies?: string[];

  /**
   * Extra request header names (case-insensitive) whose value is replaced with `[REDACTED]` at
   * capture, before anything is persisted or shown. **Merged with** the built-in sensitive-header
   * list (`authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`,
   * `proxy-authorization`) — naming one header here never stops the built-ins from being masked.
   * Drop them deliberately with {@link useDefaultMaskHeaders}.
   *
   * @deprecated Use {@link redaction}'s `headers` instead. Kept functional (merged additively
   * with `redaction.headers`) for one release cycle.
   */
  maskHeaders?: string[];

  /**
   * Mask the built-in sensitive request headers on top of {@link maskHeaders}. Default: `true`.
   * Set to `false` only to take over masking entirely — a captured `authorization` header is a
   * replayable credential for as long as the profile lives.
   *
   * @deprecated Use {@link redaction}'s `useDefaults: false` instead.
   */
  useDefaultMaskHeaders?: boolean;

  /**
   * Extra query-parameter names (case-insensitive, `-`/`_` insensitive) whose value is replaced
   * with `[REDACTED]` at capture, in both the stored URL and the parsed query. **Merged with**
   * the built-in list (`token`, `access_token`, `code`, `state`, `signature`, `password`,
   * `secret`, `api_key`…); drop those with {@link useDefaultMaskQueryParams}.
   *
   * Parameter names are kept and only values masked, so a captured URL still reads
   * `?token=[REDACTED]` and stays diagnosable.
   *
   * @deprecated Use {@link redaction}'s `queryParams` instead. Kept functional (merged additively
   * with `redaction.queryParams`) for one release cycle.
   */
  maskQueryParams?: string[];

  /**
   * Mask the built-in sensitive query parameters on top of {@link maskQueryParams}. Default:
   * `true`. Set to `false` only to take over masking entirely — a password-reset token, an OAuth
   * `code` or a URL signature is directly replayable from a stored profile.
   *
   * @deprecated Use {@link redaction}'s `useDefaults: false` instead.
   */
  useDefaultMaskQueryParams?: boolean;

  /**
   * Emit the `X-Debug-Token` / `X-Debug-Token-Link` response headers on profiled responses.
   * They reveal the dashboard location and a direct link to the captured data, so you may
   * want them off in shared/staging environments. Default: `true`.
   */
  emitDebugHeaders?: boolean;

  /** Custom predicate; return `true` to skip profiling. Applied together with `ignorePaths` (either one matching skips the request). Compose with `combineFilters` for multiple conditions. */
  ignoreRequest?: ProfilerRequestFilter;

  /** Performance-tagging configuration (custom rules for the N+1/slow engine). */
  performance?: ProfilerPerformanceOptions;

  /**
   * Process-level runtime metrics — the **Runtime** dashboard view: memory, CPU, event-loop lag
   * and garbage collection, sampled on an interval. Pass `false` to turn it off, or an object to
   * tune the interval and how much history is kept. Default: enabled, sampling every 5 s.
   *
   * Every profile also carries its **own** CPU, memory and event-loop figures, which cost two
   * syscalls and are always collected. One caveat applies to both, and is worth knowing before
   * reading a number: they are process-wide deltas over the profile's window. Node runs one
   * thread, so under concurrent traffic a request is charged with what its neighbours spent too.
   * That is the right trade for a tool used while driving requests one at a time, and the UI says
   * so where the numbers are shown.
   */
  runtime?: boolean | ProfilerRuntimeOptions;

  /**
   * What counts as a **failed HTTP request** — what earns the `error` tag and what the list's
   * `Errors` filter keeps. Default: a 5xx status, or a captured exception when no status was
   * recorded; 4xx like `401`/`403`/`404` are answers, not errors.
   *
   * ```ts
   * ProfilerModule.forRoot({ error: { httpStatus: 400 } }); // count 4xx too
   * ```
   *
   * This governs the built-in `http` kind only. Every other kind carries its own definition,
   * configured on its own package — `GraphQLCollectorModule.forRoot({ error })`,
   * `RabbitMqCollectorModule.forRoot({ error })` — since a status code means nothing to them.
   * Outgoing HTTP calls are judged separately, via `HttpCollectorModule.forRoot({ error })`.
   */
  error?: ProfilerErrorOptions;

  /**
   * Custom indexed facets attached to every profile — the equivalent of a tag/attribute set on
   * an APM span. Merged into {@link ProfilerCoreService.getIndexAttributes}, so each facet is
   * queryable as `attributes.<key>` through the storage API (`ProfilerQuery`'s `where`) the same
   * way the built-in `exception` facet already is — register your own {@link ProfilerListFilter}
   * against that field path to expose it as a list-page filter control; a custom key gets no
   * filter row automatically.
   *
   * Pass a plain object to attach the **same** facets to every profile regardless of entrypoint
   * kind (e.g. `{ env: process.env.NODE_ENV }`), computed once at startup. Pass a function to
   * derive facets **per HTTP request** (e.g. `(req) => ({ tenant: req.headers['x-tenant-id'] })`)
   * — only HTTP profiles get these, since a request is only available at that capture point (the
   * same limitation `requestId` has today).
   *
   * ```ts
   * ProfilerModule.forRoot({
   *   attributes: (req) => ({ tenant: req.headers['x-tenant-id'] as string }),
   * });
   * ```
   */
  attributes?:
    | Record<string, SummaryPrimitive>
    | ((req: ProfilerFilterRequest) => Record<string, SummaryPrimitive>);

  /**
   * A build/release identifier (a semver, a commit hash…) stamped on every profile and shown in
   * its header. Useful once profiles outlive a deploy — `storageType: 'file'` or a SQLite
   * adapter survive restarts, so nothing else says which build produced an old profile.
   *
   * Stamped on the way to storage rather than at capture, so a profile built by a package of its
   * own (a CLI command, a consumed message) carries it too.
   */
  version?: string;

  /**
   * Force-capture a request regardless of {@link sampleRate} — the escape hatch a sampled
   * environment needs to guarantee one specific request is never lost to the dice roll (e.g. a
   * `X-Profiler: 1` header). Evaluated **before** the sample-rate roll, but **after**
   * `ignoreRequest`/`ignorePaths` — those remain a hard "never profile this", which `alwaysProfile`
   * cannot override.
   *
   * ```ts
   * ProfilerModule.forRoot({
   *   sampleRate: 0.1,
   *   alwaysProfile: (req) => req.headers['x-profiler'] === '1',
   * });
   * ```
   */
  alwaysProfile?: ProfilerForceProfileFilter;

  /**
   * Default for the Execution Trace's "Hide under" control, in milliseconds. Default: `0` — show
   * every span.
   *
   * Zero on purpose. Hiding by default is the wrong bias for a debugging tool: a developer who
   * cannot find a span they know they opened has no reason to suspect a threshold, and will
   * conclude the profiler missed it. The control sits one click away in the panel, and a team that
   * always wants the same floor sets it here. `0.1` is a sensible value once the automatic
   * instrumentation is on, where sub-tenth-of-a-millisecond method calls are noise.
   */
  traceMinDuration?: number;

  /**
   * Header the inbound **trace id** is adopted from, case-insensitive. Default: `'x-request-id'`.
   *
   * The trace id is the profile's *correlation* identity: printed into your application's log
   * lines when {@link attachTraceIdToLogs} is on, readable in the dashboard, and — unlike the
   * storage token — allowed to come from the caller, so an upstream service and this one file the
   * same request under the same id. Point it at `x-correlation-id`, `x-amzn-trace-id` or whatever
   * your edge already sets.
   *
   * An inbound value is adopted only if it is short and made of URL-safe characters; anything else
   * is silently replaced by a generated UUID. It reaches log lines, the UI and outgoing headers, so
   * it is treated as the untrusted input it is.
   *
   * Extracting an id out of a composite format (a W3C `traceparent`) is deliberately not built in:
   * parsing a format the profiler does not propagate end to end would suggest an interoperability
   * it does not provide. Point this at the header, or normalize it at your edge.
   */
  traceIdHeader?: string;

  /**
   * Prefix the application's own log output with the current trace id, so a line scrolling in a
   * terminal — or landing in an aggregator — leads back to the profile that produced it. Applies
   * to loggers wrapped with `createProfilerLogger`. Default: `true`.
   *
   * This is what makes the trace id worth having: the profiler's own UI already knows which lines
   * belong to which profile, but nothing outside it does.
   */
  attachTraceIdToLogs?: boolean;

  /**
   * Trace **why** a request was or wasn't profiled — the profiler route itself, `ignoreRequest`,
   * `ignorePaths`, or the `sampleRate` roll — via `Logger.debug`. Off by default; turn it on when
   * a request unexpectedly does not show up in the dashboard. Default: `false`.
   */
  debug?: boolean;

  /**
   * Attach a source-code excerpt to every captured exception's application stack frames — the
   * Symfony exception page, locally: no data ever leaves the machine. Default: `true`. Pass
   * `false` to keep the grouped stack without reading any source, or an object to tune
   * `linesOfContext`/`maxFrames`.
   *
   * Applies to every captured exception, whichever entrypoint raised it — an HTTP request, a
   * CLI command, a consumed message.
   *
   * Only application frames are read — those resolving under {@link projectRoot}, with a
   * recognised source extension. Both guards matter: `Error#stack` can carry
   * attacker-influenced text, so a reader without them would turn a forged error message into
   * "read any file off the host". Source maps are not resolved: run Node with
   * `--enable-source-maps` and `Error.stack` already carries original-source positions.
   */
  sourceContext?: boolean | SourceContextOptions;

  /**
   * Root the application's own source lives under. Default: `process.cwd()`.
   *
   * Two jobs: it tells an application stack frame apart from a dependency or a Node internal, and
   * it is the directory {@link sourceContext} is allowed to read inside. Set it when the process
   * does not start from the application root — a monorepo launched from the repo root, say.
   */
  projectRoot?: string;

  /**
   * Turn every source location in the Exceptions tab into a link that opens the file in your
   * editor, at the right line — Symfony's `framework.ide`. Default: none, locations render as
   * plain text.
   *
   * A known name (`vscode`, `vscode-insiders`, `cursor`, `windsurf`, `zed`, `webstorm`, `idea`,
   * `phpstorm`, `sublime`, `textmate`) or a URL template carrying `%f` (absolute path) and `%l`
   * (line), e.g. `'myeditor://open?file=%f&line=%l'`.
   */
  editor?: ProfilerEditorName | (string & {});
}

/** Configuration for the performance-tagging rule engine ({@link analyzeProfile}). */
export interface ProfilerPerformanceOptions {
  /**
   * Extra {@link PerformanceRule}s appended to the built-ins (slow, N+1,
   * error, chatty, large-payload). Each rule tags collected entries or the profile;
   * its emitted tag ids become filterable on the list page. Equivalent to calling
   * {@link ProfilerCoreService.registerPerformanceRule} for each at startup.
   */
  rules?: PerformanceRule[];
}

export type ProfilerModuleAsyncOptions = ConfigurableModuleAsyncOptions<ProfilerModuleOptions> & {
  isGlobal?: boolean;

  /**
   * Enable the profiler. Default: `true`. Set to `false` to disable.
   *
   * Unlike the rest of the options, this is a **synchronous, top-level**
   * bootstrap flag (not resolved by `useFactory`): the active layer must be
   * included or skipped at module-build time, before the async factory runs.
   */
  enabled?: boolean;
};

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: NEST_PROFILER_MODULE_OPTIONS } =
  new ConfigurableModuleBuilder<ProfilerModuleOptions>().setClassMethodName('forRoot').build();

/**
 * Synchronous boolean token mirroring the resolved `enabled` decision.
 * Injected into {@link ProfilerModule} so `configure()` can decide whether to
 * mount the middleware without relying on mutable static state.
 */
export const PROFILER_ENABLED = Symbol('PROFILER_ENABLED');
