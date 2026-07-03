import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';
import type { IProfilerStorageAdapter } from './storage/storage-adapter.interface';
import type { ProfilerRequestFilter } from './filters';

export interface ProfilerModuleOptions {
  /**
   * Enable the profiler. Default: `true`. Set to `false` to disable.
   *
   * This is a synchronous bootstrap decision: when `false`, only the inert
   * {@link ProfilerService} is registered (no middleware, interceptor,
   * controller, storage or collectors). The host application decides per
   * environment — packages never read `process.env` themselves.
   */
  enabled?: boolean;

  /**
   * Bearer token required to access the profiler UI. When set, requests must
   * send `Authorization: Bearer <token>`. When omitted, the guard falls back to
   * the `PROFILER_TOKEN` environment variable; if neither is set, the profiler
   * is open (intended for local development only).
   */
  token?: string;

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

  /** Custom predicate called after `ignorePaths`; return `true` to skip profiling. Compose with `combineFilters` for multiple conditions. */
  ignoreRequest?: ProfilerRequestFilter;
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
