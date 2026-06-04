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

  /** Base path for the profiler UI. Default: '/_profiler' */
  path?: string;

  /** Maximum number of profiles kept (LRU eviction). Default: 100 */
  maxProfiles?: number;

  /** Profile TTL in seconds. Default: 3600 (1h) */
  ttl?: number;

  /** Register the module as a global NestJS module. Default: false */
  isGlobal?: boolean;

  /** Capture request and response bodies. Default: false */
  collectBody?: boolean;

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

  /** Paths to skip profiling (string prefix or RegExp). */
  ignorePaths?: (string | RegExp)[];

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
