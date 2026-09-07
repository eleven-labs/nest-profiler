import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import * as os from 'node:os';
import {
  constants as perfConstants,
  monitorEventLoopDelay,
  performance,
  PerformanceObserver,
} from 'node:perf_hooks';
import type { EventLoopUtilization } from 'node:perf_hooks';
import * as v8 from 'node:v8';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import { registerGcCounter } from '../utils/profile-metrics.util';
import type { GcCounter } from '../utils/profile-metrics.util';
import type {
  RuntimeCollectorData,
  RuntimeHeapStatistics,
  RuntimeProcessInfo,
  RuntimeSample,
} from './runtime-metrics.interface';

const DEFAULT_INTERVAL = 5000;
const DEFAULT_HISTORY_SIZE = 120;
/** Never sample faster than this: below it the interval costs more than it measures. */
const MIN_INTERVAL = 250;

/**
 * A GC entry's `detail.kind`, mapped to the bucket the panel groups by.
 *
 * Read from Node's own constants rather than written out as numbers. The literals are easy to get
 * backwards — `1` is a **scavenge**, not a major collection — and getting them backwards is worse
 * than not reporting kinds at all: eleven major collections in two seconds is an emergency, while
 * eleven scavenges is a process doing its job.
 *
 * `WEAKCB` is deliberately unmapped: it is a weak-callback pass, not a collection anyone reasons
 * about when reading a latency spike.
 */
const GC_KINDS: Record<number, 'minor' | 'major' | 'incremental'> = (() => {
  // Widened for one legacy constant: `MINOR_MARK_SWEEP` exists in the runtime but not in
  // `@types/node`, and dropping it would silently unbucket a kind on the Node versions that
  // still report it.
  const gc = perfConstants as typeof perfConstants & Record<string, number | undefined>;
  const kinds: Record<number, 'minor' | 'major' | 'incremental'> = {
    [gc.NODE_PERFORMANCE_GC_MINOR]: 'minor',
    [gc.NODE_PERFORMANCE_GC_MAJOR]: 'major',
    [gc.NODE_PERFORMANCE_GC_INCREMENTAL]: 'incremental',
  };
  const minorMarkSweep = gc['NODE_PERFORMANCE_GC_MINOR_MARK_SWEEP'];
  if (minorMarkSweep !== undefined) kinds[minorMarkSweep] = 'minor';
  return kinds;
})();

function emptyByKind(): RuntimeSample['gc']['byKind'] {
  return {
    minor: { count: 0, duration: 0 },
    major: { count: 0, duration: 0 },
    incremental: { count: 0, duration: 0 },
  };
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Samples what the *process* is doing, on an interval, for the **Runtime** panel.
 *
 * The per-request numbers on a profile say how much one execution cost. They cannot say whether
 * the heap has been climbing all afternoon, whether the loop is being blocked, or whether a major
 * collection runs every few seconds — a leak is a shape over time, not a value on one request.
 * This is where that shape comes from.
 *
 * Everything it reads is in `node:*`, so there is no dependency to install and nothing to
 * configure beyond the interval. It is also the only thing observing garbage collection, so it
 * publishes its counters for the per-profile `gc` delta to difference against.
 */
@Injectable()
export class RuntimeMetricsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RuntimeMetricsService.name);
  readonly enabled: boolean;
  readonly interval: number;
  private readonly historySize: number;

  private timer: NodeJS.Timeout | undefined;
  private lagHistogram: ReturnType<typeof monitorEventLoopDelay> | undefined;
  private gcObserver: PerformanceObserver | undefined;

  /** Cumulative GC totals since startup — what a per-profile delta is differenced against. */
  private gcTotal: GcCounter = { count: 0, duration: 0 };
  /** GC accumulated since the last sample, reset on each one.  */
  private gcWindow = { count: 0, duration: 0, byKind: emptyByKind() };

  /**
   * Seeded here rather than in `onModuleInit`, which never runs when metrics are disabled and
   * returns early before setting them. A reading taken in that window would difference against
   * the epoch, which reads as decades of CPU and pins the first sample at a nonsense value.
   */
  private lastCpu: NodeJS.CpuUsage = process.cpuUsage();
  private lastCpuAt: number = Date.now();
  private lastElu: EventLoopUtilization = performance.eventLoopUtilization();

  private readonly samples: RuntimeSample[] = [];

  constructor(
    @Optional()
    @Inject(NEST_PROFILER_MODULE_OPTIONS)
    options: ProfilerModuleOptions = {},
  ) {
    const runtime = options.runtime;
    const resolved = typeof runtime === 'boolean' ? { enabled: runtime } : (runtime ?? {});
    this.enabled = resolved.enabled !== false;
    this.interval = Math.max(MIN_INTERVAL, resolved.interval ?? DEFAULT_INTERVAL);
    this.historySize = Math.max(1, resolved.historySize ?? DEFAULT_HISTORY_SIZE);
  }

  onModuleInit(): void {
    if (!this.enabled) return;

    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = Date.now();
    this.lastElu = performance.eventLoopUtilization();

    this.lagHistogram = monitorEventLoopDelay({ resolution: 10 });
    this.lagHistogram.enable();

    this.gcObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        this.gcTotal.count++;
        this.gcTotal.duration += entry.duration;
        this.gcWindow.count++;
        this.gcWindow.duration += entry.duration;
        // `detail` is only on the GC entry type; the observer's callback is typed with the
        // generic `PerformanceEntry`, hence the narrowing.
        const detail = (entry as { detail?: { kind?: number } }).detail;
        const kind = GC_KINDS[detail?.kind ?? -1];
        if (kind) {
          this.gcWindow.byKind[kind].count++;
          this.gcWindow.byKind[kind].duration += entry.duration;
        }
      }
    });
    this.gcObserver.observe({ type: 'gc' });

    // Published so a profile's `gc` delta can be differenced against the same counters.
    registerGcCounter(() => ({ ...this.gcTotal }));

    // `unref` so a sampled process can still exit on its own — a CLI command must not be held
    // open by a metrics timer.
    this.timer = setInterval(() => this.sample(), this.interval);
    this.timer.unref?.();

    // One sample immediately, so the panel is not empty for the first interval.
    this.sample();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.gcObserver?.disconnect();
    this.lagHistogram?.disable();
    this.timer = undefined;
    this.gcObserver = undefined;
    this.lagHistogram = undefined;
    registerGcCounter(undefined);
  }

  /** Takes one reading and appends it to the bounded history. */
  private sample(): void {
    try {
      const at = Date.now();
      const memory = process.memoryUsage();
      const cpu = process.cpuUsage(this.lastCpu);
      const elapsed = Math.max(1, at - this.lastCpuAt);
      const elu = performance.eventLoopUtilization(this.lastElu);
      const totalMemory = os.totalmem();

      const sample: RuntimeSample = {
        at,
        memory: {
          rss: memory.rss,
          heapTotal: memory.heapTotal,
          heapUsed: memory.heapUsed,
          external: memory.external,
          arrayBuffers: memory.arrayBuffers,
          percentOfTotal: round((memory.rss / totalMemory) * 100),
        },
        cpu: {
          user: round(cpu.user / 1000),
          system: round(cpu.system / 1000),
          percent: round(((cpu.user + cpu.system) / 1000 / elapsed) * 100),
        },
        eventLoop: {
          lag: this.readLag(),
          utilization: Number.isFinite(elu.utilization) ? round(elu.utilization, 4) : 0,
        },
        gc: {
          count: this.gcWindow.count,
          duration: round(this.gcWindow.duration),
          byKind: this.gcWindow.byKind,
        },
      };

      this.lastCpu = process.cpuUsage();
      this.lastCpuAt = at;
      this.lastElu = performance.eventLoopUtilization();
      this.gcWindow = { count: 0, duration: 0, byKind: emptyByKind() };
      this.lagHistogram?.reset();

      this.samples.push(sample);
      if (this.samples.length > this.historySize) this.samples.shift();
    } catch (err) {
      // A sampler must never be able to take the application down; a gap in a trend is survivable.
      this.logger.warn(
        `Failed to sample runtime metrics: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Reads the loop-delay histogram, in milliseconds.
   *
   * Every value is `NaN` until the histogram has recorded its first sample, and a `NaN` that
   * reaches a numeric field survives, poisons every average built over it and makes a comparison
   * undefined — so it is turned into `0` here rather than downstream.
   */
  private readLag(): RuntimeSample['eventLoop']['lag'] {
    const histogram = this.lagHistogram;
    const ms = (nanoseconds: number): number =>
      Number.isFinite(nanoseconds) ? round(nanoseconds / 1e6) : 0;
    if (!histogram) return { mean: 0, p50: 0, p99: 0, max: 0 };
    return {
      mean: ms(histogram.mean),
      p50: ms(histogram.percentile(50)),
      p99: ms(histogram.percentile(99)),
      max: ms(histogram.max),
    };
  }

  /** Static facts about the process and its host. */
  private processInfo(): RuntimeProcessInfo {
    return {
      pid: process.pid,
      uptime: Math.round(process.uptime()),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: os.cpus().length,
      totalMemory: os.totalmem(),
      // Windows reports no load average; Node answers `[0, 0, 0]` there.
      loadAverage: os.loadavg().map((value) => round(value)),
    };
  }

  /** V8 heap accounting, read on demand — it does not change fast enough to be worth sampling. */
  private heapStatistics(): RuntimeHeapStatistics {
    const stats = v8.getHeapStatistics();
    return {
      totalHeapSize: stats.total_heap_size,
      usedHeapSize: stats.used_heap_size,
      heapSizeLimit: stats.heap_size_limit,
      percentOfLimit: round((stats.used_heap_size / stats.heap_size_limit) * 100),
      mallocedMemory: stats.malloced_memory,
      externalMemory: stats.external_memory ?? 0,
      spaces: v8
        .getHeapSpaceStatistics()
        .map((space) => ({
          name: space.space_name,
          size: space.space_size,
          used: space.space_used_size,
          available: space.space_available_size,
        }))
        .sort((a, b) => b.size - a.size),
    };
  }

  /** The panel's whole payload. */
  snapshot(): RuntimeCollectorData {
    return {
      enabled: this.enabled,
      interval: this.interval,
      process: this.processInfo(),
      heap: this.heapStatistics(),
      current: this.samples[this.samples.length - 1],
      history: [...this.samples],
    };
  }
}
