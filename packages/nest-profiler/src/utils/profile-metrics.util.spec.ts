import {
  completeProfilePerformance,
  markProfileStart,
  profileElapsedMs,
  registerGcCounter,
} from './profile-metrics.util';
import type { Profile } from '../interfaces/profile.interface';

function makeProfile(startTime = Date.now()): Profile {
  return {
    token: 't',
    traceId: 'trace-test',
    createdAt: startTime,
    entrypoint: { type: 'http', data: {} },
    performance: { startTime, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

/** Enough allocation and arithmetic that CPU time and a heap delta are measurable. */
function burnCpu(): void {
  const noise: string[] = [];
  let sink = 0;
  for (let i = 0; i < 200_000; i++) {
    sink += i;
    if (i % 1000 === 0) noise.push(`row-${i}-${sink}`);
  }
  if (noise.length === 0) throw new Error('unreachable');
}

afterEach(() => registerGcCounter(undefined));

describe('completeProfilePerformance', () => {
  it('sets the duration on the monotonic clock', () => {
    const profile = makeProfile();
    markProfileStart(profile);
    completeProfilePerformance(profile);
    expect(profile.performance.duration).toBeGreaterThanOrEqual(0);
  });

  it('reports the CPU time consumed while the profile was open', () => {
    const profile = makeProfile();
    markProfileStart(profile);
    burnCpu();
    completeProfilePerformance(profile);

    const cpu = profile.performance.cpu;
    expect(cpu).toBeDefined();
    expect(cpu!.total).toBeGreaterThan(0);
    expect(cpu!.total).toBeCloseTo(cpu!.user + cpu!.system, 3);
    // In milliseconds, not the microseconds `process.cpuUsage` reports.
    expect(cpu!.total).toBeLessThan(10_000);
  });

  it('differences the heap delta against the very reading it displays as the start', () => {
    // These were two separate `memoryUsage()` calls, so the tab could show `97.16MB → 97.25MB`
    // next to a delta of `-0.42MB` — three numbers that cannot all be true.
    const profile = makeProfile();
    profile.performance.heapUsed = 0; // whatever the caller had put there
    markProfileStart(profile);
    burnCpu();
    completeProfilePerformance(profile);

    const memory = profile.performance.memory!;
    expect(profile.performance.heapUsed).toBeGreaterThan(0);
    expect(memory.heapUsedAfter - profile.performance.heapUsed).toBe(memory.heapDelta);
  });

  it('reports memory at the end of the profile and how much it moved', () => {
    const profile = makeProfile();
    markProfileStart(profile);
    burnCpu();
    completeProfilePerformance(profile);

    const memory = profile.performance.memory;
    expect(memory).toBeDefined();
    expect(memory!.heapUsedAfter).toBeGreaterThan(0);
    expect(memory!.rss).toBeGreaterThan(0);
    // A delta is a difference, so it may legitimately be negative when a collection ran.
    expect(Number.isFinite(memory!.heapDelta)).toBe(true);
    expect(Number.isFinite(memory!.rssDelta)).toBe(true);
  });

  it('reports event-loop utilization over the window', () => {
    const profile = makeProfile();
    markProfileStart(profile);
    burnCpu();
    completeProfilePerformance(profile);

    const loop = profile.performance.eventLoop;
    expect(loop).toBeDefined();
    expect(loop!.utilization).toBeGreaterThanOrEqual(0);
    expect(loop!.utilization).toBeLessThanOrEqual(1);
    expect(loop!.active).toBeGreaterThanOrEqual(0);
    expect(loop!.idle).toBeGreaterThanOrEqual(0);
  });

  it('reports the garbage collections of the window when something observes them', () => {
    let counter = { count: 7, duration: 12.5 };
    registerGcCounter(() => counter);

    const profile = makeProfile();
    markProfileStart(profile);
    counter = { count: 10, duration: 20 };
    completeProfilePerformance(profile);

    // The delta over the window, not the process totals.
    expect(profile.performance.gc).toEqual({ count: 3, duration: 7.5 });
  });

  it('omits gc entirely when nothing is observing collections', () => {
    const profile = makeProfile();
    markProfileStart(profile);
    completeProfilePerformance(profile);
    expect(profile.performance.gc).toBeUndefined();
  });

  it('never reports a negative gc delta, whatever the counter does', () => {
    let counter = { count: 10, duration: 20 };
    registerGcCounter(() => counter);
    const profile = makeProfile();
    markProfileStart(profile);
    counter = { count: 4, duration: 5 }; // a counter that went backwards
    completeProfilePerformance(profile);
    expect(profile.performance.gc).toEqual({ count: 0, duration: 0 });
  });

  it('reports the duration but no resource usage for a profile that was never marked', () => {
    // A custom entrypoint kind built by hand: reporting the process totals as if they were the
    // profile's would be a lie rather than a gap.
    const profile = makeProfile(Date.now() - 100);
    completeProfilePerformance(profile);

    expect(profile.performance.duration).toBeGreaterThanOrEqual(100);
    expect(profile.performance.cpu).toBeUndefined();
    expect(profile.performance.memory).toBeUndefined();
    expect(profile.performance.eventLoop).toBeUndefined();
  });

  it('rounds every measurement to microseconds rather than shipping float noise', () => {
    const profile = makeProfile();
    markProfileStart(profile);
    burnCpu();
    completeProfilePerformance(profile);

    const decimals = (value: number): number => (String(value).split('.')[1] ?? '').length;
    for (const value of [
      profile.performance.duration!,
      profile.performance.cpu!.total,
      profile.performance.eventLoop!.active,
    ]) {
      expect(decimals(value)).toBeLessThanOrEqual(3);
    }
  });

  it('leaves the profile JSON-serialisable, with no plumbing on the object', () => {
    const profile = makeProfile();
    markProfileStart(profile);
    completeProfilePerformance(profile);

    expect(JSON.parse(JSON.stringify(profile))).toEqual(profile);
  });

  it('keeps each profile on its own baseline', () => {
    const first = makeProfile();
    const second = makeProfile();
    markProfileStart(first);
    burnCpu();
    markProfileStart(second);
    completeProfilePerformance(first);
    completeProfilePerformance(second);

    // `first` was open across the work, `second` only after it.
    expect(first.performance.cpu!.total).toBeGreaterThanOrEqual(second.performance.cpu!.total);
  });
});

describe('profileElapsedMs', () => {
  it('still measures on the monotonic clock after the baseline moved modules', () => {
    const profile = makeProfile(1_000_000);
    markProfileStart(profile);

    jest.spyOn(Date, 'now').mockReturnValue(500_000); // wall clock stepped backwards
    const elapsed = profileElapsedMs(profile);
    jest.restoreAllMocks();

    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(1_000);
  });
});
