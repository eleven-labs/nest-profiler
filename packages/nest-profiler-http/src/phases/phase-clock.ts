/**
 * Duration between two {@link monotonicNow} marks, in milliseconds, rounded to microsecond
 * precision and clamped at `0`.
 *
 * Clamped because the marks a phase is derived from are not always ordered: a request body can be
 * flushed to a socket before that socket finished its handshake, and a negative phase would flow
 * straight into the stacked bar as a negative width.
 */
export function phaseSpan(from: number, to: number): number {
  return Math.round(Math.max(0, to - from) * 1000) / 1000;
}
