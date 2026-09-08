import { randomUUID } from 'node:crypto';

/** Header the default generator adopts an inbound trace id from. */
export const DEFAULT_TRACE_ID_HEADER = 'x-request-id';

/**
 * Longest inbound id accepted. Comfortably above every id format in circulation (a UUID is 36
 * characters, a W3C `traceparent` 55) and far below what would bloat a log line or a stored
 * profile.
 */
const MAX_TRACE_ID_LENGTH = 128;

/**
 * Characters an adopted id may contain: the alphabet shared by UUIDs, ULIDs, hex ids, and the
 * `traceparent` format.
 *
 * An allowlist rather than a denylist, because of where this value ends up. A `traceId` is
 * printed into the application's own log lines, rendered in the dashboard, and echoed on outgoing
 * requests — so an unvalidated one is a log-injection primitive (a newline forges log entries), a
 * stored-XSS candidate, and a header-splitting vector all at once. The same reasoning is already
 * applied to `Error#stack` before reading source frames from it: a value that came from outside is
 * not a trusted one, however innocuous the field name sounds.
 */
const SAFE_TRACE_ID = /^[A-Za-z0-9._~-]+$/;

/**
 * Whether an inbound value is safe to adopt as a trace id. Anything else is not rejected as an
 * error — a malformed header is the caller's problem, not this request's — it simply does not get
 * adopted, and a fresh id is generated instead.
 */
export function isAdoptableTraceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_TRACE_ID_LENGTH &&
    SAFE_TRACE_ID.test(value)
  );
}

/**
 * The trace id for an execution: the inbound header when the caller sent a usable one, a fresh
 * UUID otherwise.
 *
 * @param inbound - The raw header value, which may be absent, repeated, or hostile.
 */
export function resolveTraceId(inbound: unknown): string {
  const candidate: unknown = Array.isArray(inbound) ? (inbound as unknown[])[0] : inbound;
  return isAdoptableTraceId(candidate) ? candidate : randomUUID();
}
