import type { Profile } from '../interfaces/profile.interface';

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
 * Monotonic origin of each profile, so the middleware, the interceptor and the finish hook all
 * measure the same request against the same start without agreeing on a field.
 *
 * A `WeakMap` rather than a property on the profile: this is transport plumbing, it must never
 * reach storage or the JSON export, and the entry disappears with the profile it belongs to.
 */
const monotonicStarts = new WeakMap<Profile, number>();

/**
 * Records the monotonic start of a profile. Called once, where the profile is created — the HTTP
 * middleware, or a package contributing its own entrypoint kind (a CLI command, a consumed
 * message).
 */
export function markProfileStart(profile: Profile, at: number = monotonicNow()): void {
  monotonicStarts.set(profile, at);
}

/**
 * Milliseconds elapsed since {@link markProfileStart} was called for this profile.
 *
 * Falls back to the wall-clock difference against {@link PerformanceData.startTime} for a profile
 * that was never marked — a custom entrypoint kind built by hand still reports a duration, on the
 * old terms, rather than none at all.
 */
export function profileElapsedMs(profile: Profile): number {
  const start = monotonicStarts.get(profile);
  if (start !== undefined) return elapsedMs(start);
  return Math.max(0, Date.now() - profile.performance.startTime);
}
