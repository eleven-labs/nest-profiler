import type { ClsService } from 'nestjs-cls';
import { PROFILER_CLS_KEYS } from '../constants';
import type { Profile } from '../interfaces/profile.interface';

/**
 * The single way to read the active profiling context out of the CLS store.
 *
 * Two things every caller previously had to remember, and got wrong in different places:
 *
 * - **The key.** It is a string, so a typo reads as `undefined` rather than failing — silently
 *   turning a collector into a no-op. {@link PROFILER_CLS_KEYS} existed for this and was used
 *   almost nowhere; these accessors are what make it unavoidable.
 * - **The `try`/`catch`.** `ClsService.get()` throws outside an active context, which is the
 *   normal case for anything running at bootstrap, in a background job, or when the profiler is
 *   disabled. "No active profile" is an answer, not an error, so it is returned as `undefined`.
 *
 * `cls` is optional because most collectors resolve it through `tryResolve` and legitimately get
 * `undefined` when the core is disabled.
 */

function read<T>(cls: ClsService | undefined, key: string): T | undefined {
  if (!cls) return undefined;
  try {
    // Cast because `ClsService.get` resolves its return type through a conditional that a
    // generic `T` cannot satisfy; the store is untyped here by design, since each caller knows
    // what it put under its own key.
    return cls.get<T | undefined>(key) as T | undefined;
  } catch {
    // Outside an active CLS context — no profiling is in progress.
    return undefined;
  }
}

/** The {@link Profile} being collected into, or `undefined` outside a profiled execution. */
export function readProfile<TData = unknown>(
  cls: ClsService | undefined,
): Profile<TData> | undefined {
  return read<Profile<TData>>(cls, PROFILER_CLS_KEYS.profile);
}

/** The debug token of the active profile, or `undefined` outside a profiled execution. */
export function readToken(cls: ClsService | undefined): string | undefined {
  return read<string>(cls, PROFILER_CLS_KEYS.token);
}

/**
 * The transport request of the active execution (an Express or Fastify request), or `undefined`
 * outside a profiled one. Typed loosely on purpose: what a request object is depends on the
 * platform, and a collector narrows it to the shape it needs.
 */
export function readRequest<TRequest = unknown>(cls: ClsService | undefined): TRequest | undefined {
  return read<TRequest>(cls, PROFILER_CLS_KEYS.request);
}

/**
 * Id of the {@link TraceSpan} currently open, or `undefined` outside any span.
 *
 * This is the read side of the mechanism that makes trace nesting exact: `TracerService.span()`
 * writes the id for the duration of its scope, and every instrumentation that builds an entry
 * while it is set reports it as the entry's parent. A producer and its parent therefore agree by
 * construction, instead of `buildTrace` having to guess the relation back from overlapping time
 * windows — which is wrong as soon as two operations run concurrently.
 */
export function readActiveSpanId(cls: ClsService | undefined): string | undefined {
  return read<string>(cls, PROFILER_CLS_KEYS.activeSpanId);
}

/** The correlation id of the active profile, or `undefined` outside a profiled execution. */
export function readTraceId(cls: ClsService | undefined): string | undefined {
  return read<string>(cls, PROFILER_CLS_KEYS.traceId);
}

/**
 * Marks a span as the active one for the remainder of the current CLS scope.
 *
 * Must be called *inside* a `cls.run({ ifNested: 'inherit' })` opened for the span — writing it
 * into the caller's own scope would leak the span past its own end and reparent everything that
 * follows under work that has finished.
 */
export function setActiveSpanId(cls: ClsService, spanId: string): void {
  cls.set(PROFILER_CLS_KEYS.activeSpanId, spanId);
}

/**
 * Publishes a profile and its token into the current CLS store, so anything running downstream —
 * the profiler logger, `ProfilerService`, every collector — resolves them.
 *
 * Called from inside a `cls.run()` callback by whoever owns the execution: the HTTP middleware,
 * the interceptor recovering a non-HTTP context, or a package driving its own entrypoint kind.
 */
export function setProfileContext(cls: ClsService, profile: Profile, request?: unknown): void {
  cls.set(PROFILER_CLS_KEYS.profile, profile);
  cls.set(PROFILER_CLS_KEYS.token, profile.token);
  cls.set(PROFILER_CLS_KEYS.traceId, profile.traceId);
  if (request !== undefined) cls.set(PROFILER_CLS_KEYS.request, request);
}
