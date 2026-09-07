/** Options for the process-level runtime metrics — the **Runtime** sidebar panel. */
export interface ProfilerRuntimeOptions {
  /**
   * Sample process memory, CPU, event-loop lag and garbage collection on an interval, and add a
   * **Runtime** view to the dashboard. Default: `true`.
   *
   * What this buys, beyond the per-request numbers already on every profile: those answer *how
   * much* a request cost, this answers *how the process is doing* — whether the heap has been
   * climbing all afternoon, whether the loop is being blocked, whether a major collection is
   * running every few seconds. A leak is a shape over time, not a value on one request.
   *
   * Turning it off stops the interval, releases the event-loop histogram and the GC observer, and
   * removes the view. Per-request CPU and memory are unaffected — they cost two syscalls and need
   * nothing running in the background — but per-profile `gc` is no longer reported, since nothing
   * is observing collections.
   */
  enabled?: boolean;

  /**
   * Milliseconds between samples. Default: `5000`.
   *
   * Five seconds rather than a production agent's minute: a profiler is read while the thing it
   * measures is still happening, and a minute-wide sample flattens the spike you opened the panel
   * to look at. Each sample is a handful of counter reads.
   */
  interval?: number;

  /**
   * Samples kept for the trend. Default: `120` — two hours at the default interval, bounded so a
   * long-running process cannot grow this without limit.
   */
  historySize?: number;
}

/** One reading of the process's state, taken every {@link ProfilerRuntimeOptions.interval}. */
export interface RuntimeSample {
  /** Epoch milliseconds the sample was taken. */
  at: number;
  memory: {
    /** Resident set size (bytes). */
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
    /** `rss` as a percentage of the machine's total memory. */
    percentOfTotal: number;
  };
  cpu: {
    /** Milliseconds of user CPU consumed since the previous sample. */
    user: number;
    /** Milliseconds of system CPU consumed since the previous sample. */
    system: number;
    /**
     * CPU consumed over the interval as a percentage of one core. Can exceed 100 on a process
     * doing work on several threads (libuv's pool, a native addon).
     */
    percent: number;
  };
  eventLoop: {
    /**
     * Loop delay over the interval, in milliseconds — how long a task waited before the loop got
     * to it. The percentiles are what matter: a healthy mean hides the one stall that made a
     * request slow.
     */
    lag: { mean: number; p50: number; p99: number; max: number };
    /** Fraction of the interval the loop spent active rather than idle, `0`-`1`. */
    utilization: number;
  };
  gc: {
    count: number;
    /** Total pause time over the interval (ms). */
    duration: number;
    /**
     * Per-kind totals for the interval. Always all three keys, seeded at zero: "no major
     * collection happened" and "major collections were not reported" are different facts, and
     * only the seeding keeps them apart downstream.
     */
    byKind: {
      minor: { count: number; duration: number };
      major: { count: number; duration: number };
      incremental: { count: number; duration: number };
    };
  };
}

/** V8 heap accounting, read on demand rather than sampled. */
export interface RuntimeHeapStatistics {
  totalHeapSize: number;
  usedHeapSize: number;
  heapSizeLimit: number;
  /** `usedHeapSize` as a percentage of `heapSizeLimit` — how close the process is to the ceiling. */
  percentOfLimit: number;
  mallocedMemory: number;
  externalMemory: number;
  /** Per-space breakdown, largest first. */
  spaces: { name: string; size: number; used: number; available: number }[];
}

/** Static facts about the process and the machine it runs on. */
export interface RuntimeProcessInfo {
  pid: number;
  /** Seconds since the process started. */
  uptime: number;
  nodeVersion: string;
  platform: string;
  arch: string;
  cpuCount: number;
  totalMemory: number;
  /** 1, 5 and 15-minute load averages. `[0, 0, 0]` on Windows, where the OS reports none. */
  loadAverage: number[];
}

/** What the **Runtime** panel renders. */
export interface RuntimeCollectorData {
  enabled: boolean;
  interval: number;
  process: RuntimeProcessInfo;
  heap: RuntimeHeapStatistics;
  /** The most recent sample, or `undefined` before the first interval has elapsed. */
  current?: RuntimeSample;
  /** Samples oldest-first, capped at {@link ProfilerRuntimeOptions.historySize}. */
  history: RuntimeSample[];
}
