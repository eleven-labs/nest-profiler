/**
 * Elapsed time is measured on a monotonic clock, never on the wall clock.
 *
 * `Date.now()` has two properties that make it wrong for a duration. It is millisecond-granular,
 * so anything shorter floors to `0` — which is most application work, and an execution timeline
 * whose every bar reads `0ms` cannot be compared. And it is not monotonic: an NTP step or a
 * manual clock change mid-request produces a wrong duration, and a backward step produces a
 * **negative** one, which then flows into the `slow` rule, the duration filter and the stored
 * summary.
 *
 * `performance.now()` has neither problem. Absolute timestamps (`createdAt`,
 * {@link PerformanceData.startTime}, {@link TimelineSpan.startedAt}, log and exception times)
 * stay on `Date.now()`: they are displayed, and a monotonic reading means nothing to a reader.
 */

/** Sub-microsecond monotonic reading, for one end of a measurement. */
export function monotonicNow(): number {
  return performance.now();
}

/**
 * Milliseconds elapsed since a {@link monotonicNow} reading, rounded to microsecond precision.
 *
 * Rounded rather than left raw: the full float carries ~15 digits of noise into every stored
 * profile and JSON export for no readable gain. Clamped at `0` so a duration can never be
 * negative, whatever the platform's clock does.
 */
export function elapsedMs(since: number): number {
  return Math.max(0, Math.round((performance.now() - since) * 1000) / 1000);
}

/**
 * Absolute epoch milliseconds with sub-millisecond resolution.
 *
 * `Date.now()` is the same instant at a thousand times less precision, and that precision is
 * what a waterfall needs: spans are *placed* against {@link PerformanceData.startTime}, so a
 * start rounded to the millisecond makes every sub-millisecond span land on the same pixel as
 * its neighbours — the bars stop saying which one ran first. `performance.timeOrigin` anchors
 * the process's monotonic clock to the wall clock once, at startup, so readings stay comparable
 * with `Date.now()` values recorded elsewhere while being immune to an NTP step mid-request.
 */
export function nowMs(): number {
  return roundMs(performance.timeOrigin + performance.now());
}

/** Milliseconds elapsed since a {@link nowMs} mark, clamped at `0`. */
export function sinceMs(startedAt: number): number {
  return roundMs(Math.max(nowMs() - startedAt, 0));
}

/**
 * Rounds to 3 decimals (microsecond precision).
 *
 * The full float carries ~15 digits of noise into every stored profile and JSON export for no
 * readable gain; ordering is preserved at this precision for anything a profiler measures.
 */
export function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}
