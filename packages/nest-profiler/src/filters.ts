/** Framework-agnostic request shape passed to filter predicates; avoids leaking Express/Fastify types. */
export interface ProfilerFilterRequest {
  method: string;
  url: string;
  path?: string;
  headers: Record<string, string | string[]>;
  body?: unknown;
}

/** Return `true` to skip profiling the request. */
export type ProfilerRequestFilter = (req: ProfilerFilterRequest) => boolean;

/**
 * Return `true` to force-capture the request regardless of {@link ProfilerModuleOptions.sampleRate}.
 * Evaluated **before** the sample-rate roll, so it only ever widens what a sampled environment
 * captures — it cannot resurrect a request already excluded by `ignoreRequest`/`ignorePaths`.
 *
 * Deliberately a distinct type from {@link ProfilerRequestFilter}: reusing that type here would
 * make `true` mean "skip" in one option and "force-capture" in the other, for the same request
 * shape.
 */
export type ProfilerForceProfileFilter = (req: ProfilerFilterRequest) => boolean;

/** OR combinator — skips profiling when any of the provided filters returns `true`. */
export function combineFilters(...filters: ProfilerRequestFilter[]): ProfilerRequestFilter {
  return (req: ProfilerFilterRequest) => filters.some((f) => f(req));
}
