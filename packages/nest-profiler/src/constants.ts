export const PROFILER_REQ_KEY = Symbol.for('nest_profiler_profile');

/**
 * CLS store keys shared between the core and every collector. Exported so collector
 * packages read/write the active profile and request from the same keys instead of
 * duplicating string literals.
 */
export const PROFILER_CLS_KEYS = {
  /** The active {@link Profile} for the current request/command context. */
  profile: 'profiler.profile',
  /** The active transport request object (Express/Fastify) for the current context. */
  request: 'profiler.request',
} as const;

/** The (fixed) base path where the profiler UI is mounted. */
export const PROFILER_BASE_PATH = '/_profiler';

/** Default number of profiles shown per page in each dashboard list (see `listPageSize`). */
export const DEFAULT_LIST_PAGE_SIZE = 25;
