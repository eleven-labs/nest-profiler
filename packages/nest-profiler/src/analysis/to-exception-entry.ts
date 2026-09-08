import { HttpException } from '@nestjs/common';
import type { ExceptionEntry } from '../interfaces/profile.interface';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import { captureBody, resolveHttpCaptureConfig } from '../utils/http-capture.util';
import type { HttpCaptureConfig } from '../utils/http-capture.util';
import { analyzeStack, resolveStackAnalysisOptions } from '../utils/source-context.util';
import type { StackAnalysisOptions } from '../utils/source-context.util';

/**
 * Turns whatever was thrown into the {@link ExceptionEntry} stored on a profile.
 *
 * The same four lines used to be written out at each of the places that can catch a failure —
 * the interceptor's HTTP and non-HTTP paths, the catch-all exception filter, the command
 * profiler — which is why they had all drifted into recording strictly `name`, `message` and
 * `stack`, dropping three things that matter:
 *
 * - **The cause chain.** `new Error('…', { cause })` is how a layered application reports a
 *   failure, and it is the *cause* that says what actually went wrong: an
 *   `InternalServerErrorException` tells you nothing, the `QueryFailedError` under it tells you
 *   everything. Only the outermost error was kept, so the useful half was thrown away.
 * - **The error code.** Node's own errors (`ENOENT`, `ECONNREFUSED`, `ERR_*`) and most driver
 *   errors carry a machine-readable `code` distinct from the class name — exactly what
 *   {@link ExceptionEntry.code} is for, and what the `exception` list filter groups by.
 * - **The `HttpException` payload.** See {@link ExceptionEntry.details}: for a rejected DTO it is
 *   the only place the field errors exist, `message` being the generic class message.
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

/** Keys of a Nest error body that restate what the profile already knows. */
const REDUNDANT_DETAIL_KEYS = new Set(['statusCode', 'error', 'message']);

/**
 * The response payload of an `HttpException`, or `undefined` when there is nothing to add.
 *
 * `new NotFoundException('Product #9 not found')` answers
 * `{ statusCode, error, message: 'Product #9 not found' }` — a status the profile already carries,
 * an `error` restating the class name, and the message a second time. Storing that on every
 * `HttpException` would cost bytes to say nothing, so a payload is kept only when it carries a
 * key of its own, or a `message` that is not simply the exception's.
 */
function readDetails(error: unknown, capture: HttpCaptureConfig | undefined): unknown {
  if (!capture || !(error instanceof HttpException)) return undefined;
  const payload: unknown = error.getResponse();
  if (payload === null || typeof payload !== 'object') return undefined;

  const entries = Object.entries(payload);
  const informative =
    entries.some(([key]) => !REDUNDANT_DETAIL_KEYS.has(key)) ||
    entries.some(([key, value]) => key === 'message' && value !== error.message);
  if (!informative) return undefined;

  return captureBody(payload, capture);
}

/**
 * Coerces a non-`Error` throw the way every call site already did — deliberately unchanged, so
 * consolidating them alters nothing but the additions above. The resulting `name` is `Error`,
 * which the `exception` list filter groups existing profiles by.
 */
function normalizeError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

function build(
  thrown: unknown,
  depth: number,
  seen: Set<unknown>,
  options: ExceptionCaptureOptions,
): ExceptionEntry {
  const error = normalizeError(thrown);
  const code = readCode(thrown);
  const frames = analyzeStack(error.stack, options);
  const details = readDetails(thrown, options.capture);

  const entry: ExceptionEntry = {
    name: error.name,
    message: error.message,
    ...(code !== undefined ? { code } : {}),
    stack: error.stack,
    ...(frames !== undefined ? { frames } : {}),
    ...(details !== undefined ? { details } : {}),
    timestamp: Date.now(),
  };

  const cause = (error as { cause?: unknown }).cause;
  // `seen` guards a cycle (an error wrapping something that wraps it back), which is rare but
  // would otherwise recurse until the depth cap and store the same frames several times over.
  if (cause !== undefined && cause !== null && depth < MAX_CAUSE_DEPTH && !seen.has(cause)) {
    seen.add(cause);
    entry.cause = build(cause, depth + 1, seen, options);
  }

  return entry;
}

/** Everything {@link toExceptionEntry} reads, resolved once from the module options. */
export interface ExceptionCaptureOptions extends StackAnalysisOptions {
  /**
   * Bounding and masking for {@link ExceptionEntry.details}, on the same settings a captured body
   * gets (`maxBodySize`, `bodyCaptureLimits`, `redaction`). Omit to record no payload at all.
   */
  capture?: HttpCaptureConfig;
}

/**
 * Resolves the module options every capture site shares — the interceptor, the catch-all filter,
 * `TracerService.captureError`, a package building its own profile — so one setting governs them
 * all rather than each resolving its own half.
 */
export function resolveExceptionCaptureOptions(
  options: ProfilerModuleOptions,
): ExceptionCaptureOptions {
  return { ...resolveStackAnalysisOptions(options), capture: resolveHttpCaptureConfig(options) };
}

/**
 * Builds the {@link ExceptionEntry} for a thrown value, following its `cause` chain.
 *
 * @param thrown - Whatever reached the `catch`. Any value, not necessarily an `Error`.
 * @param options - Resolved by {@link resolveExceptionCaptureOptions}; omit `sourceContext` to
 *   record the frames without reading any source off disk.
 */
export function toExceptionEntry(
  thrown: unknown,
  options: ExceptionCaptureOptions = {},
): ExceptionEntry {
  return build(thrown, 0, new Set([thrown]), options);
}
