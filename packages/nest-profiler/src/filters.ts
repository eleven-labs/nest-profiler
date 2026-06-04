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

/** OR combinator — skips profiling when any of the provided filters returns `true`. */
export function combineFilters(...filters: ProfilerRequestFilter[]): ProfilerRequestFilter {
  return (req: ProfilerFilterRequest) => filters.some((f) => f(req));
}
