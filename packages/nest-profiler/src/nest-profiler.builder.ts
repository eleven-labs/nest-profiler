import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { CanActivate, ConfigurableModuleAsyncOptions, Type } from '@nestjs/common';
import type { IProfilerStorageAdapter } from './storage/storage-adapter.interface';
import type { ProfilerRequestFilter } from './filters';
import type { PerformanceRule } from './analysis/performance-rule.interface';
import type { PlatformRequest, PlatformResponse } from './types/http';

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

  /** Cookie names whose value should be replaced with '***'. */
  maskCookies?: string[];

  /**
   * Request header names (case-insensitive) whose value is replaced with `[REDACTED]` at
   * capture, before anything is persisted or shown. Defaults to a sensible sensitive-header
   * list (`authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`,
   * `proxy-authorization`). Pass your own list to override.
   */
  maskHeaders?: string[];

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
