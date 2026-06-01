/**
 * Single, synchronous source of truth for whether the profiler is active.
 *
 * The decision belongs to the host application — the `@eleven-labs/nest-profiler`
 * packages never read `process.env` themselves. This flag is read at module
 * load time and forwarded as `enabled` to every profiler `forRoot(...)` call.
 */
export const profilerEnabled = process.env['NODE_ENV'] !== 'production';
