import { PROFILER_REQ_KEY } from './constants';
import { PROFILER_ENABLED } from './nest-profiler.builder';
import { PROFILER_STORAGE_ADAPTER } from './storage/storage-adapter.interface';

/**
 * A symbol used as a DI token, or as a key two packages exchange data under, must keep one
 * identity across every copy of this package a dependency tree happens to contain — a pnpm tree
 * resolving a collector against a different version of the core, or a dual CJS/ESM build. A bare
 * `Symbol()` is unique per module instance, so the provider and the injection point end up with
 * different tokens and Nest reports the provider as simply missing, with nothing in the message
 * pointing at the duplication.
 *
 * `Symbol.for` is what makes that impossible: the registry is per process, not per module
 * instance. These assertions are the guard — a token that regresses to `Symbol()` fails here
 * rather than in an application nobody can debug.
 */
describe('cross-instance DI tokens', () => {
  it.each([
    ['PROFILER_REQ_KEY', PROFILER_REQ_KEY],
    ['PROFILER_ENABLED', PROFILER_ENABLED],
    ['PROFILER_STORAGE_ADAPTER', PROFILER_STORAGE_ADAPTER],
  ])('%s is registered in the global symbol registry', (_name, token) => {
    const key = Symbol.keyFor(token);
    expect(key).toBeDefined();
    // A registry key is global to the process, so it is namespaced to this project.
    expect(key).toMatch(/^nest_profiler_/);
    expect(Symbol.for(key as string)).toBe(token);
  });
});
