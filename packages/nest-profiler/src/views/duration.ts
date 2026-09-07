/**
 * Renders a duration for display, without its unit.
 *
 * Durations are measured on a monotonic clock and carry decimals, so they cannot be printed
 * raw: `1.6000000000058208` is noise, and rounding everything to an integer is what made
 * every sub-millisecond span read `0ms` and the execution timeline unusable. Precision is
 * therefore traded against magnitude — two decimals where they carry the whole signal, none
 * where they carry nothing.
 *
 * Trailing zeros are trimmed (`1.60` → `1.6`), and a value too small to show at this
 * precision reads `<0.01` rather than `0.00`: "faster than we can display" and "took no
 * time" are different facts.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return '0';
  if (ms < 0.01) return '<0.01';
  if (ms < 10) return trimZeros(ms.toFixed(2));
  if (ms < 100) return trimZeros(ms.toFixed(1));
  return String(Math.round(ms));
}

function trimZeros(value: string): string {
  return value.replace(/\.?0+$/, '');
}
