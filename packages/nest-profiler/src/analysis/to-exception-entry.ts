import type { ExceptionEntry } from '../interfaces/profile.interface';

/**
 * Turns whatever was thrown into the {@link ExceptionEntry} stored on a profile.
 *
 * The same four lines used to be written out at each of the places that can catch a failure —
 * the interceptor's HTTP and non-HTTP paths, the catch-all exception filter, the command
 * profiler — which is why they had all drifted into recording strictly `name`, `message` and
 * `stack`, dropping two things that matter:
 *
 * - **The cause chain.** `new Error('…', { cause })` is how a layered application reports a
 *   failure, and it is the *cause* that says what actually went wrong: an
 *   `InternalServerErrorException` tells you nothing, the `QueryFailedError` under it tells you
 *   everything. Only the outermost error was kept, so the useful half was thrown away.
 * - **The error code.** Node's own errors (`ENOENT`, `ECONNREFUSED`, `ERR_*`) and most driver
 *   errors carry a machine-readable `code` distinct from the class name — exactly what
 *   {@link ExceptionEntry.code} is for, and what the `exception` list filter groups by.
 *
 * A non-`Error` throw (a string, a plain object) is coerced the way every call site already
 * coerced it, so nothing is lost relative to the previous behaviour.
 */

/** How deep a `cause` chain is followed. Deep enough for real wrapping, bounded for storage. */
const MAX_CAUSE_DEPTH = 5;

/** Reads a string `code` off an error-like value, ignoring anything else (a numeric errno, say). */
function readCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0 ? code : undefined;
}

/**
 * Coerces a non-`Error` throw the way every call site already did — deliberately unchanged, so
 * consolidating them alters nothing but the two additions above. The resulting `name` is `Error`,
 * which the `exception` list filter groups existing profiles by.
 */
function normalizeError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

function build(thrown: unknown, depth: number, seen: Set<unknown>): ExceptionEntry {
  const error = normalizeError(thrown);
  const code = readCode(thrown);

  const entry: ExceptionEntry = {
    name: error.name,
    message: error.message,
    ...(code !== undefined ? { code } : {}),
    stack: error.stack,
    timestamp: Date.now(),
  };

  const cause = (error as { cause?: unknown }).cause;
  // `seen` guards a cycle (an error wrapping something that wraps it back), which is rare but
  // would otherwise recurse until the depth cap and store the same frames several times over.
  if (cause !== undefined && cause !== null && depth < MAX_CAUSE_DEPTH && !seen.has(cause)) {
    seen.add(cause);
    entry.cause = build(cause, depth + 1, seen);
  }

  return entry;
}

/**
 * Builds the {@link ExceptionEntry} for a thrown value, following its `cause` chain.
 *
 * @param thrown - Whatever reached the `catch`. Any value, not necessarily an `Error`.
 */
export function toExceptionEntry(thrown: unknown): ExceptionEntry {
  return build(thrown, 0, new Set([thrown]));
}
