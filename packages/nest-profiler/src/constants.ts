export const PROFILER_REQ_KEY = Symbol.for('nest_profiler_profile');

/**
 * CLS store keys shared between the core and every collector. Exported so collector
 * packages read/write the active profile and request from the same keys instead of
 * duplicating string literals.
 */
export const PROFILER_CLS_KEYS = {
  /** The active {@link Profile} for the current request/command context. */
  profile: 'profiler.profile',
  /** The debug token of the active profile — what the dashboard and the toolbar address it by. */
  token: 'profiler.token',
  /** The active transport request object (Express/Fastify) for the current context. */
  request: 'profiler.request',
  /** The correlation id of the active profile — see `Profile.traceId`. */
  traceId: 'profiler.traceId',
  /**
   * Id of the {@link TraceSpan} currently open, rewritten by every nested `TracerService.span()`
   * scope. This is what makes trace nesting *exact* rather than inferred: anything capturing
   * while it is set — a query patch, an outgoing call, a log line — reads it and reports its
   * real parent, without the producer and the consumer having to agree on anything else.
   *
   * **Flat on purpose — do not "tidy" it into `profiler.activeSpanId`.** `ClsService.get`/`set`
   * read a dotted key as a *path*, so `profiler.activeSpanId` writes into a nested
   * `store.profiler` object; and `cls.run({ ifNested: 'inherit' })` copies the store only one
   * level deep, so parent and child scopes share that nested object. This is the one key written
   * *inside* a nested scope, so it is the one key for which the difference is observable: dotted,
   * a span leaks its id back to its caller's scope, and the next sibling span is recorded as its
   * child. Two concurrent operations then nest under one another — the exact defect explicit
   * parenting exists to remove. Covered by a regression test in `tracer.service.spec.ts`.
   */
  activeSpanId: 'profilerActiveSpanId',
  /**
   * How many instrumented calls deep the current execution is. Read by the automatic
   * instrumentation to stop opening spans past `maxDepth` — a waterfall 40 levels deep answers no
   * question, and every level past the point you stopped reading still costs a span and a row in
   * the stored profile. Flat, for the same reason as {@link activeSpanId}.
   */
  activeSpanDepth: 'profilerActiveSpanDepth',
} as const;

/** The (fixed) base path where the profiler UI is mounted. */
export const PROFILER_BASE_PATH = '/_profiler';

/** Default number of profiles shown per page in each dashboard list (see `listPageSize`). */
export const DEFAULT_LIST_PAGE_SIZE = 25;
