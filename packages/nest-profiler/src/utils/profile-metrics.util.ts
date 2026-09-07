import { performance } from 'node:perf_hooks';
import type { EventLoopUtilization } from 'node:perf_hooks';
import type { Profile } from '../interfaces/profile.interface';
import { elapsedMs, monotonicNow } from './clock.utils';

/**
 * Per-profile resource accounting: what the process was doing when a profile opened, so what it
 * did *during* the profile can be reported as a difference.
 *
 * Every number here is a **process-wide delta over the profile's window**, not an isolated
 * measurement of that one execution. Node runs one thread, so under concurrency a request's
 * window overlaps its neighbours' and the CPU it is charged with includes theirs. That is
 * acceptable — and genuinely useful — in the setting a profiler is used in, where requests are
 * driven one at a time; it is stated in the option docs and in the UI rather than left for
 * someone to discover from a number that does not add up.
 *
 * The cost is two syscalls per profile (`process.cpuUsage`, `process.memoryUsage`) plus one
 * userland read (`eventLoopUtilization`), which is why it needs no opting into.
 */

interface ProfileBaseline {
  /** Monotonic reading, for the duration. */
  monotonic: number;
  cpu: NodeJS.CpuUsage;
  memory: NodeJS.MemoryUsage;
  eventLoop: EventLoopUtilization;
  /** Cumulative GC counters at open, or `undefined` when nothing is observing GC. */
  gc: GcCounter | undefined;
}

/** Cumulative garbage-collection totals since the process started. */
export interface GcCounter {
  count: number;
  duration: number;
}

/**
 * Baselines per profile.
 *
 * A `WeakMap` rather than fields on the profile: these are transport plumbing, they must never
 * reach storage or the JSON export, and the entry disappears with the profile it belongs to.
 */
const baselines = new WeakMap<Profile, ProfileBaseline>();

/**
 * Reads the process's cumulative GC totals, when something is observing them.
 *
 * Registered by {@link RuntimeMetricsService} at startup rather than injected, because the three
 * places that open a profile do so through free functions — the HTTP middleware, and the packages
 * contributing their own entrypoint kinds. Absent (so GC is simply not reported) when runtime
 * metrics are disabled, since observing GC means keeping a `PerformanceObserver` alive for the
 * life of the process and that is not something to switch on behind an application's back.
 */
let readGcCounter: (() => GcCounter) | undefined;

/** Installs the GC counter source. Called once, by whoever owns the observer. */
export function registerGcCounter(read: (() => GcCounter) | undefined): void {
  readGcCounter = read;
}

/**
 * Records where a profile starts: the monotonic clock, and the resource counters its usage is
 * differenced against. Called once, where the profile is created.
 */
export function markProfileStart(profile: Profile, at: number = monotonicNow()): void {
  const memory = process.memoryUsage();
  baselines.set(profile, {
    monotonic: at,
    cpu: process.cpuUsage(),
    memory,
    eventLoop: performance.eventLoopUtilization(),
    gc: readGcCounter?.(),
  });
  // The displayed "heap at start" and the baseline the delta is differenced against have to be
  // the *same* reading. They were two separate `memoryUsage()` calls a few statements apart, so
  // the Performance tab could show `97.16MB → 97.25MB` next to a delta of `-0.42MB` — three
  // numbers that cannot all be true. One read, used for both.
  profile.performance.heapUsed = memory.heapUsed;
}

/**
 * Milliseconds elapsed since {@link markProfileStart} was called for this profile.
 *
 * Falls back to the wall-clock difference against {@link PerformanceData.startTime} for a profile
 * that was never marked — a custom entrypoint kind built by hand still reports a duration, on the
 * old terms, rather than none at all.
 */
export function profileElapsedMs(profile: Profile): number {
  const baseline = baselines.get(profile);
  if (baseline !== undefined) return elapsedMs(baseline.monotonic);
  return Math.max(0, Date.now() - profile.performance.startTime);
}

/** Rounds to microsecond precision, the way durations are, and never returns a negative. */
function round(value: number): number {
  return Math.max(0, Math.round(value * 1000) / 1000);
}

/**
 * Completes `profile.performance`: the duration, and the resource usage over the profile's
 * window. Called from wherever a profile is finalized, in place of setting `duration` alone.
 *
 * Resource usage is omitted for a profile that was never marked — there is no baseline to
 * difference against, and reporting the process totals as if they belonged to the profile would
 * be a lie rather than a gap.
 */
export function completeProfilePerformance(profile: Profile): void {
  profile.performance.duration = profileElapsedMs(profile);

  const baseline = baselines.get(profile);
  if (!baseline) return;

  const cpu = process.cpuUsage(baseline.cpu);
  const memory = process.memoryUsage();
  const eventLoop = performance.eventLoopUtilization(baseline.eventLoop);

  // µs → ms, so CPU is comparable with the duration it is read against.
  profile.performance.cpu = {
    user: round(cpu.user / 1000),
    system: round(cpu.system / 1000),
    total: round((cpu.user + cpu.system) / 1000),
  };

  profile.performance.memory = {
    heapUsedAfter: memory.heapUsed,
    heapDelta: memory.heapUsed - baseline.memory.heapUsed,
    rss: memory.rss,
    rssDelta: memory.rss - baseline.memory.rss,
    external: memory.external,
  };

  profile.performance.eventLoop = {
    // `utilization` is already a 0-1 ratio over the window; idle and active are ms.
    utilization: Number.isFinite(eventLoop.utilization)
      ? Math.round(eventLoop.utilization * 10000) / 10000
      : 0,
    idle: round(eventLoop.idle),
    active: round(eventLoop.active),
  };

  const gcNow = readGcCounter?.();
  if (gcNow && baseline.gc) {
    profile.performance.gc = {
      count: Math.max(0, gcNow.count - baseline.gc.count),
      duration: round(gcNow.duration - baseline.gc.duration),
    };
  }
}
