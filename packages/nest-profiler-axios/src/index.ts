/**
 * @deprecated `@eleven-labs/nest-profiler-axios` has been renamed to
 * `@eleven-labs/nest-profiler-http`, which is now client-agnostic (axios is one
 * built-in adapter). This package only re-exports it; install
 * `@eleven-labs/nest-profiler-http` and migrate `AxiosCollectorModule` →
 * `HttpCollectorModule`. It will be removed in a future release.
 */
export * from '@eleven-labs/nest-profiler-http';

import { HttpCollectorModule } from '@eleven-labs/nest-profiler-http';
import type { HttpCollectorModuleOptions } from '@eleven-labs/nest-profiler-http';

/**
 * @deprecated Use `HttpCollectorModule` from `@eleven-labs/nest-profiler-http`.
 * Kept as a drop-in alias; axios instrumentation is enabled by default.
 */
export const AxiosCollectorModule = HttpCollectorModule;

/** @deprecated Use `HttpCollectorModuleOptions` from `@eleven-labs/nest-profiler-http`. */
export type AxiosCollectorModuleOptions = HttpCollectorModuleOptions;
