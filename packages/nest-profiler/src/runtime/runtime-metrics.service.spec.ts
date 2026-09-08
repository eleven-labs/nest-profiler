import { RuntimeMetricsService } from './runtime-metrics.service';
import { completeProfilePerformance, markProfileStart } from '../utils/profile-metrics.util';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { Profile } from '../interfaces/profile.interface';

function makeService(options: ProfilerModuleOptions = {}): RuntimeMetricsService {
  return new RuntimeMetricsService(options);
}

function makeProfile(): Profile {
  return {
    token: 't',
    traceId: 'trace-test',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: {} },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

describe('RuntimeMetricsService', () => {
  let service: RuntimeMetricsService | undefined;

  afterEach(() => {
    service?.onApplicationShutdown();
    service = undefined;
    jest.useRealTimers();
  });

  describe('options', () => {
    it('is enabled by default, sampling every five seconds', () => {
      service = makeService();
      expect(service.enabled).toBe(true);
      expect(service.interval).toBe(5000);
    });

    it('accepts the boolean shorthand', () => {
      expect(makeService({ runtime: false }).enabled).toBe(false);
      expect(makeService({ runtime: true }).enabled).toBe(true);
    });

    it('accepts an explicit interval', () => {
      expect(makeService({ runtime: { interval: 1000 } }).interval).toBe(1000);
    });

    it('floors the interval, so a mistaken 0 cannot spin the loop', () => {
      expect(makeService({ runtime: { interval: 0 } }).interval).toBe(250);
      expect(makeService({ runtime: { interval: -5 } }).interval).toBe(250);
    });
  });

  describe('sampling', () => {
    it('has a sample as soon as it starts, rather than an empty panel for one interval', () => {
      service = makeService({ runtime: { interval: 250 } });
      service.onModuleInit();

      const snapshot = service.snapshot();
      expect(snapshot.history).toHaveLength(1);
      expect(snapshot.current).toBe(snapshot.history[0]);
    });

    it('reports a plausible first CPU sample instead of decades of it', () => {
      // The baselines are seeded in the constructor: differencing against the epoch would
      // report the whole process lifetime as this interval's CPU.
      service = makeService({ runtime: { interval: 250 } });
      service.onModuleInit();

      const cpu = service.snapshot().current!.cpu;
      expect(cpu.percent).toBeGreaterThanOrEqual(0);
      expect(cpu.percent).toBeLessThan(100_000);
      expect(cpu.user).toBeGreaterThanOrEqual(0);
    });

    it('never reports NaN for loop lag, before the histogram has a sample', () => {
      service = makeService({ runtime: { interval: 250 } });
      service.onModuleInit();

      const lag = service.snapshot().current!.eventLoop.lag;
      for (const value of [lag.mean, lag.p50, lag.p99, lag.max]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    });

    it('appends a sample per interval and caps the history', () => {
      jest.useFakeTimers();
      service = makeService({ runtime: { interval: 250, historySize: 3 } });
      service.onModuleInit();

      for (let i = 0; i < 5; i++) jest.advanceTimersByTime(250);

      const history = service.snapshot().history;
      expect(history).toHaveLength(3);
      // Oldest first, so a trend reads left to right.
      expect(history[0]!.at).toBeLessThanOrEqual(history[2]!.at);
    });

    it('buckets real collections by kind — a scavenge is minor, not major', async () => {
      // Getting the kind constants backwards is worse than not reporting kinds at all: eleven
      // "major" collections in two seconds reads as an emergency, eleven scavenges is a process
      // doing its job. Driven through the real observer rather than a stubbed callback, because
      // the mapping is exactly the thing under test.
      service = makeService({ runtime: { interval: 60_000 } });
      service.onModuleInit();

      let sink: object[] = [];
      for (let i = 0; i < 400_000; i++) {
        sink.push({ i, s: `row-${i}` });
        if (sink.length > 20_000) sink = [];
      }
      // Observer callbacks land on a later tick.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const byKind = (
        service as unknown as {
          gcWindow: { count: number; byKind: Record<string, { count: number }> };
        }
      ).gcWindow;

      expect(byKind.count).toBeGreaterThan(0);
      // Allocation churn produces scavenges; they must land in `minor`.
      expect(byKind.byKind['minor']!.count).toBeGreaterThan(0);
      // And every entry that carried a mapped kind is accounted for exactly once.
      const bucketed = Object.values(byKind.byKind).reduce((sum, b) => sum + b.count, 0);
      expect(bucketed).toBeLessThanOrEqual(byKind.count);
    });

    it('seeds every GC kind at zero, so "none happened" differs from "not reported"', () => {
      service = makeService({ runtime: { interval: 250 } });
      service.onModuleInit();

      expect(service.snapshot().current!.gc.byKind).toEqual({
        minor: { count: 0, duration: 0 },
        major: { count: 0, duration: 0 },
        incremental: { count: 0, duration: 0 },
      });
    });
  });

  describe('disabled', () => {
    it('takes no sample and starts nothing', () => {
      service = makeService({ runtime: false });
      service.onModuleInit();

      const snapshot = service.snapshot();
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.history).toHaveLength(0);
      expect(snapshot.current).toBeUndefined();
    });

    it('still reports the process and heap facts, which need no sampler', () => {
      service = makeService({ runtime: false });
      const snapshot = service.snapshot();

      expect(snapshot.process.pid).toBe(process.pid);
      expect(snapshot.heap.heapSizeLimit).toBeGreaterThan(0);
    });

    it('leaves per-profile gc unreported, since nothing observes collections', () => {
      service = makeService({ runtime: false });
      service.onModuleInit();

      const profile = makeProfile();
      markProfileStart(profile);
      completeProfilePerformance(profile);

      expect(profile.performance.gc).toBeUndefined();
      // The cheap per-request figures are unaffected by the option.
      expect(profile.performance.cpu).toBeDefined();
      expect(profile.performance.memory).toBeDefined();
    });
  });

  describe('snapshot', () => {
    it('reports the heap against its own limit', () => {
      service = makeService();
      const heap = service.snapshot().heap;

      expect(heap.usedHeapSize).toBeGreaterThan(0);
      expect(heap.percentOfLimit).toBeGreaterThan(0);
      expect(heap.percentOfLimit).toBeLessThanOrEqual(100);
      expect(heap.spaces.length).toBeGreaterThan(0);
      // Largest space first, so the table leads with where the heap actually sits.
      expect(heap.spaces[0]!.size).toBeGreaterThanOrEqual(heap.spaces.at(-1)!.size);
    });

    it('is JSON-serialisable, since the panel renders it server-side', () => {
      service = makeService({ runtime: { interval: 250 } });
      service.onModuleInit();

      const snapshot = service.snapshot();
      expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    });

    it('hands out a copy of the history, so a caller cannot mutate it', () => {
      service = makeService({ runtime: { interval: 250 } });
      service.onModuleInit();

      service.snapshot().history.length = 0;
      expect(service.snapshot().history).toHaveLength(1);
    });
  });

  describe('shutdown', () => {
    it('stops sampling and releases the gc counter', () => {
      jest.useFakeTimers();
      service = makeService({ runtime: { interval: 250 } });
      service.onModuleInit();
      const before = service.snapshot().history.length;

      service.onApplicationShutdown();
      jest.advanceTimersByTime(2000);

      expect(service.snapshot().history).toHaveLength(before);

      const profile = makeProfile();
      markProfileStart(profile);
      completeProfilePerformance(profile);
      expect(profile.performance.gc).toBeUndefined();
    });

    it('is safe to call when it never started', () => {
      service = makeService({ runtime: false });
      expect(() => service!.onApplicationShutdown()).not.toThrow();
    });
  });
});
