import { performance } from 'perf_hooks';

/**
 * Sub-millisecond wall clock, shared by every timed surface (lifecycle phases, queries,
 * outgoing HTTP calls, GraphQL fields…).
 *
 * `Date.now()` only resolves to the millisecond, which is coarser than most of what the
 * profiler times: a `START TRANSACTION`, its `INSERT` and its `COMMIT` all land on the same
 * integer millisecond, so the trace cannot tell which ran first nor which contains which.
 * `performance.timeOrigin + performance.now()` keeps the same epoch-ms basis (and stays
 * comparable with `Date.now()` values) while carrying microsecond precision.
 */
export function nowMs(): number {
  return roundMs(performance.timeOrigin + performance.now());
}

/** Elapsed time since a {@link nowMs} mark, in fractional milliseconds. */
export function sinceMs(startedAt: number): number {
  return roundMs(Math.max(nowMs() - startedAt, 0));
}

/**
 * Rounds to 3 decimals (microsecond), so serialized profiles carry stable, readable numbers
 * instead of full float noise while keeping ordering intact.
 */
export function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Human-readable duration in the unit that fits it: nanoseconds, microseconds, milliseconds,
 * seconds, then minutes and hours. Rounding a value into the next unit up is lossy — it is
 * what turned a real query into a misleading `0ms` — so the unit follows the value instead of
 * the other way round, at both ends of the scale: a profiled CLI command or a slow consumer
 * reads as `2m 5s`, not `125000ms`. Decimals stop once they are noise.
 */
export function formatMs(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '\u2014';
  if (value === 0) return '0ms';

  if (value >= 3_600_000) {
    const hours = Math.floor(value / 3_600_000);
    const minutes = Math.round((value % 3_600_000) / 60_000);
    // 59.6min rounds to 60, which belongs to the next hour rather than to `1h 60m`.
    return minutes === 60 ? `${hours + 1}h` : `${hours}h ${minutes}m`;
  }
  if (value >= 60_000) {
    const minutes = Math.floor(value / 60_000);
    const seconds = Math.round((value % 60_000) / 1000);
    if (seconds !== 60) return `${minutes}m ${seconds}s`;
    // The rounded seconds carry into the next minute, which may itself carry into an hour.
    return minutes === 59 ? '1h' : `${minutes + 1}m`;
  }
  if (value >= 1000) return `${trim((value / 1000).toFixed(value >= 10_000 ? 1 : 2))}s`;
  if (value >= 100) return `${Math.round(value)}ms`;
  if (value >= 1) return `${trim(value.toFixed(value >= 10 ? 1 : 2))}ms`;

  const micros = value * 1000;
  if (micros >= 1) return `${Math.round(micros)}\u00b5s`;
  return `${Math.round(micros * 1000)}ns`;
}

/** Drops trailing zeros: a flat 12ms should not read as `12.00ms`. */
function trim(fixed: string): string {
  return fixed.replace(/\.?0+$/, '');
}
