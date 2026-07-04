import type { ModuleRef } from '@nestjs/core';

/**
 * Resolves a provider from anywhere in the application (including global modules) without
 * throwing when it is absent.
 *
 * This is the correct way for a collector to depend on the profiler core's global providers
 * (`ClsService`, `ProfilerCoreService`) or a host's ORM connection: a plain `@Optional()`
 * constructor dependency does NOT traverse to global modules from a *dynamic* feature module
 * (it resolves to `undefined` even when the provider exists), whereas `ModuleRef.get(token,
 * { strict: false })` searches the whole graph. Wrapped in a try/catch so a missing provider
 * (e.g. the core disabled via `ProfilerNoopModule`) degrades to `undefined` instead of crashing
 * the bootstrap.
 *
 * Call it from `onModuleInit`/`onApplicationBootstrap` (once the graph is built), not the
 * constructor.
 */
export function tryResolve<T>(
  moduleRef: ModuleRef,
  token: Parameters<ModuleRef['get']>[0],
): T | undefined {
  try {
    return moduleRef.get<T>(token, { strict: false });
  } catch {
    return undefined;
  }
}
