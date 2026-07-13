import type { ProfileSummary, SummaryPrimitive } from '../storage/profile-summary';

/**
 * The aggregated overview behind the home **Summary** view, computed from a page of lightweight
 * {@link ProfileSummary} rows (never full documents), so it has no coupling to any collector. Distinct
 * from {@link ProfileSummary} (one per profile): a `ProfilerSummary` aggregates many into statistics.
 */
export interface ProfilerSummary {
  /** Number of profiles aggregated (the bounded window actually scanned). */
  readonly sampled: number;
  /** Duration distribution over profiles with a measured (non-zero) duration, in ms. */
  readonly duration: {
    readonly avg: number;
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
  };
  /** Failures: a profile with a 5xx status or a captured exception. */
  readonly errors: {
    readonly count: number;
    /** `count / sampled`, in `[0, 1]`; `0` for an empty window. */
    readonly rate: number;
  };
  /** Request count per HTTP method (methodless kinds — commands, messages — are omitted). */
  readonly byMethod: Record<string, number>;
  /** Request count per HTTP status class; keys are always present (`0` when none). */
  readonly byStatusClass: Record<'2xx' | '3xx' | '4xx' | '5xx', number>;
  /**
   * Profile count per performance-tag id (`slow`, `n-plus-one`…), derived dynamically. The `error`
   * tag is excluded — failures are reported via {@link errors}, not as an issue.
   */
  readonly issues: Record<string, number>;
  /** The slowest endpoints by average duration, ranked desc (entrypoint-agnostic). */
  readonly topSlowEndpoints: readonly SlowEndpoint[];
  /** The most recent failures (5xx or exception), newest first. */
  readonly recentErrors: readonly RecentError[];
  /** Profile count per entrypoint kind (`http`, `graphql`, `command`, `rabbitmq`…). */
  readonly byType: Record<string, number>;
  /** The window bucketed over time (oldest → newest): count, error count and p95 per bucket. */
  readonly timeline: readonly TimeBucket[];
  /**
   * Per performance-tag id, the most-affected endpoints ranked by occurrence — the issue↔endpoint
   * correlation. Keyed by tag id (`error` excluded); empty when nothing is tagged.
   */
  readonly issueEndpoints: Record<string, readonly EndpointCount[]>;
  /**
   * Process V8 heap over the window (bytes): latest, min/max and a coarse trend (`null` when none
   * carried a reading). The trend compares the oldest and newest fifths, like the Profiling chart.
   */
  readonly heap: HeapSummary | null;
  /** The effective per-table row cap (`summary.topN`, default 5), echoed so the view can label "Top N …". */
  readonly topN: number;
}

export interface HeapSummary {
  /** Most recent heapUsed in the window (bytes). */
  readonly current: number;
  readonly min: number;
  readonly max: number;
  readonly trend: 'stable' | 'growing' | 'leak';
  /** Recent heapUsed readings (bytes), oldest → newest, capped for the sparkline. */
  readonly series: readonly number[];
}

export interface TimeBucket {
  /** Start timestamp of the bucket (ms since epoch). */
  readonly startedAt: number;
  readonly count: number;
  readonly errorCount: number;
  /** p95 latency in ms over the bucket's measured requests (`0` when none measured). */
  readonly p95: number;
}

export interface EndpointCount {
  readonly method?: string;
  readonly badge?: string;
  readonly path: string;
  readonly count: number;
  /** Mean duration in ms over the affected endpoint's measured calls (`0` when none measured). */
  readonly avg: number;
  /** Token of a representative profile (the most recent one) for a drill-through to its detail. */
  readonly token?: string;
}

export interface SlowEndpoint {
  /** HTTP method, when the endpoint is an HTTP request — drives the drill-through method filter. */
  readonly method?: string;
  /** Display badge: the HTTP method, or the kind badge for non-HTTP (`CLI`, `RMQ`, `GQL`…). */
  readonly badge?: string;
  /**
   * The endpoint label: the matched HTTP route (`/users/:id`) or `method` + URL, or — for a
   * non-HTTP kind — its own descriptor (a command name, a `exchange → routingKey`, a GraphQL op).
   */
  readonly path: string;
  readonly calls: number;
  /** Mean duration in ms over the group's measured calls. */
  readonly avg: number;
}

export interface RecentError {
  readonly token: string;
  /** HTTP method, when the failed profile is an HTTP request. */
  readonly method?: string;
  /** Display badge: the HTTP method, or the kind badge for non-HTTP (`CLI`, `RMQ`, `GQL`…). */
  readonly badge?: string;
  readonly path: string;
  readonly statusCode?: number;
  /** `createdAt` timestamp of the profile (ms since epoch). */
  readonly at: number;
}

/** Performance-tag id that denotes a failure, surfaced via `errors` rather than `issues`. */
const ERROR_TAG_ID = 'error';

/** Default per-table row cap (slowest endpoints, recent errors, per-issue endpoints). */
const DEFAULT_TOP_N = 5;
/** Number of buckets the time-series trend is split into. */
const TIMELINE_BUCKETS = 24;

/** Options steering the aggregation. */
export interface ComputeSummaryOptions {
  /** Per-table row cap (top N), clamped to at least `1`. Default: {@link DEFAULT_TOP_N}. */
  readonly topN?: number;
  /** Failure test for the error rate/recent errors/timeline. Default: {@link defaultIsError}. */
  readonly isError?: (summary: ProfileSummary) => boolean;
}

/** The index-only view of a profile handed to a {@link ProfilerErrorClassification.classify} predicate. */
export interface ProfileErrorInfo {
  /** Entrypoint kind (`http`, `graphql`, `command`, `rabbitmq`…). */
  readonly type: string;
  /** HTTP method, when the profile is an HTTP request. */
  readonly method?: string;
  /** HTTP status code, when the kind carries one. */
  readonly statusCode?: number;
  /** Whether the profile captured an unhandled exception. */
  readonly hasExceptions: boolean;
  /** Performance-tag ids on the profile (e.g. `['slow', 'error']`). */
  readonly tags: readonly string[];
  /** Kind-specific index facets (a command exit status…). */
  readonly attributes: Record<string, SummaryPrimitive>;
}

/**
 * How the Summary qualifies a **failure** (`summary.error`). Layered: `classify` wins when it returns
 * a boolean, else a captured exception (unless {@link exceptions} is `false`) or a status matching
 * {@link httpStatus} counts. Default: a 5xx status or an exception — so 4xx like 401/404 are not
 * counted. Governs only the Summary; the Profiling list's `error` tag is a separate rule-engine concern.
 */
export interface ProfilerErrorClassification {
  /** Codes counting as an error: a lower bound (`code >= n`) or a predicate. Default: `code >= 500`. */
  readonly httpStatus?: number | ((statusCode: number) => boolean);
  /** Count a captured unhandled exception as an error. Default: `true`. */
  readonly exceptions?: boolean;
  /**
   * Custom classifier for every profile: `true`/`false` to decide, `undefined` to defer to
   * {@link exceptions} / {@link httpStatus}. Qualifies kinds without a status code from their own
   * {@link ProfileErrorInfo.tags | tags} / {@link ProfileErrorInfo.attributes | attributes}.
   */
  readonly classify?: (info: ProfileErrorInfo) => boolean | undefined;
}

/** The built-in failure test: a 5xx response or a captured exception. */
export function defaultIsError(s: ProfileSummary): boolean {
  return s.hasExceptions || (s.statusCode !== undefined && s.statusCode >= 500);
}

/** Splits the space-delimited tag ids (`' slow error '` → `['slow', 'error']`). */
function tagList(s: ProfileSummary): string[] {
  return s.tags.trim().split(/\s+/).filter(Boolean);
}

/** Resolves a {@link ProfilerErrorClassification} into the failure predicate ({@link defaultIsError} when unset). */
export function resolveErrorClassifier(
  config?: ProfilerErrorClassification,
): (s: ProfileSummary) => boolean {
  if (!config) return defaultIsError;
  const countExceptions = config.exceptions ?? true;
  const httpStatus = config.httpStatus;
  const matchesStatus =
    typeof httpStatus === 'function' ? httpStatus : (code: number) => code >= (httpStatus ?? 500);
  const { classify } = config;
  return (s) => {
    if (classify) {
      const verdict = classify({
        type: s.type,
        method: s.method,
        statusCode: s.statusCode,
        hasExceptions: s.hasExceptions,
        tags: tagList(s),
        attributes: s.attributes,
      });
      if (verdict !== undefined) return verdict;
    }
    if (countExceptions && s.hasExceptions) return true;
    return s.statusCode !== undefined && matchesStatus(s.statusCode);
  };
}

/** The display fields identifying an endpoint, entrypoint-agnostic (HTTP or otherwise). */
interface EndpointDescriptor {
  /** HTTP method, when applicable (drives the drill-through method filter). */
  readonly method?: string;
  /** Display badge: HTTP method or the kind badge (`CLI`, `RMQ`, `GQL`…). */
  readonly badge?: string;
  /** The low-cardinality endpoint label used for grouping and display. */
  readonly path: string;
}

/** A non-empty string attribute value, or `undefined` when absent / non-string / empty. */
function stringAttr(s: ProfileSummary, key: string): string | undefined {
  const value = s.attributes[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * The endpoint display descriptor for any kind: non-HTTP kinds use their own `endpoint` /
 * `endpointBadge` index attributes (so they group by a meaningful label, not a blank HTTP row);
 * HTTP falls back to its route pattern, then the URL, then the type.
 */
function describeEndpoint(s: ProfileSummary): EndpointDescriptor {
  const endpoint = stringAttr(s, 'endpoint');
  if (endpoint) return { badge: stringAttr(s, 'endpointBadge'), path: endpoint };
  // HTTP: the method rides the badge, never prefixed into the path (which would duplicate it).
  return { method: s.method, badge: s.method, path: s.route ?? s.url ?? s.type };
}

/** Stable grouping key: same label under different methods (GET vs POST /x) stays distinct. */
function endpointKey(s: ProfileSummary, ep: EndpointDescriptor): string {
  return `${s.type} ${ep.method ?? ep.badge ?? ''} ${ep.path}`;
}

/**
 * The nearest-rank percentile of an ascending-sorted array, in `[0, 100]`. Returns `0` for an
 * empty input. `p100` is the max, `p0`/tiny arrays clamp to the first element.
 */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const index = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[index] ?? 0;
}

/** The status class bucket (`2xx`…`5xx`) of a status code, or `undefined` outside 200–599. */
function statusClass(statusCode: number): '2xx' | '3xx' | '4xx' | '5xx' | undefined {
  if (statusCode >= 200 && statusCode < 300) return '2xx';
  if (statusCode < 400) return '3xx';
  if (statusCode < 500) return '4xx';
  if (statusCode < 600) return '5xx';
  return undefined;
}

/**
 * Buckets the window's `createdAt` span into up to {@link TIMELINE_BUCKETS} equal slices (oldest →
 * newest), each with its count, error count and p95. One bucket for an instant window, `[]` for empty.
 */
function buildTimeline(
  summaries: readonly ProfileSummary[],
  isError: (s: ProfileSummary) => boolean,
): TimeBucket[] {
  if (summaries.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const s of summaries) {
    if (s.createdAt < min) min = s.createdAt;
    if (s.createdAt > max) max = s.createdAt;
  }
  const span = max - min;
  // Cap buckets by sample size so a small window isn't split into mostly-empty slices.
  const bucketCount = span === 0 ? 1 : Math.min(TIMELINE_BUCKETS, summaries.length);
  const size = span === 0 ? 1 : span / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    startedAt: Math.round(min + i * size),
    count: 0,
    errorCount: 0,
    durations: [] as number[],
  }));
  for (const s of summaries) {
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((s.createdAt - min) / size)));
    const bucket = buckets[idx]!;
    bucket.count++;
    if (isError(s)) bucket.errorCount++;
    if (s.duration > 0) bucket.durations.push(s.duration);
  }
  return buckets.map((b) => ({
    startedAt: b.startedAt,
    count: b.count,
    errorCount: b.errorCount,
    p95: percentile(
      b.durations.sort((a, c) => a - c),
      95,
    ),
  }));
}

/** 1 MiB in bytes — the heap-trend thresholds. */
const MB = 1024 * 1024;

/** Max points kept for the heap sparkline (the most recent readings). */
const HEAP_SERIES_MAX = 40;

/**
 * Summarizes the process heap over the window: latest / min / max and a coarse trend comparing the
 * oldest and newest fifths (same heuristic as the Profiling heap chart). `null` when nothing carried
 * a heap reading.
 */
function buildHeap(summaries: readonly ProfileSummary[]): HeapSummary | null {
  const series = [...summaries]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((s) => s.heapUsed)
    .filter((v) => v > 0);
  if (series.length === 0) return null;
  const chunk = Math.max(1, Math.floor(series.length / 5));
  const mean = (xs: number[]) => xs.reduce((sum, v) => sum + v, 0) / xs.length;
  const delta = mean(series.slice(-chunk)) - mean(series.slice(0, chunk));
  const trend = delta > 5 * MB ? 'leak' : delta > MB ? 'growing' : 'stable';
  return {
    current: series[series.length - 1] ?? 0,
    min: Math.min(...series),
    max: Math.max(...series),
    trend,
    series: series.slice(-HEAP_SERIES_MAX),
  };
}

/**
 * Aggregates a bounded window of {@link ProfileSummary} rows into a {@link ProfilerSummary}. Pure and
 * total (empty-shaped for an empty window). Percentiles/avg exclude the `duration === 0` sentinel;
 * `byMethod`/`byStatusClass` only count profiles carrying those HTTP fields; endpoint labels are
 * entrypoint-agnostic (see {@link describeEndpoint}).
 */
export function computeProfilerSummary(
  summaries: readonly ProfileSummary[],
  options: ComputeSummaryOptions = {},
): ProfilerSummary {
  const sampled = summaries.length;
  const topN = Math.max(1, Math.floor(options.topN ?? DEFAULT_TOP_N));
  const isError = options.isError ?? defaultIsError;

  const measuredDurations = summaries
    .map((s) => s.duration)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  const avg =
    measuredDurations.length === 0
      ? 0
      : measuredDurations.reduce((sum, d) => sum + d, 0) / measuredDurations.length;

  const byMethod: Record<string, number> = {};
  const byStatusClass: Record<'2xx' | '3xx' | '4xx' | '5xx', number> = {
    '2xx': 0,
    '3xx': 0,
    '4xx': 0,
    '5xx': 0,
  };
  const issues: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let errorCount = 0;

  // One group per endpoint: running duration sum + measured-call count for the average.
  const groups = new Map<
    string,
    {
      method?: string;
      badge?: string;
      path: string;
      calls: number;
      durationSum: number;
      measured: number;
    }
  >();
  // Per performance-tag id, the endpoints carrying it (keyed the same way), for the correlation.
  const issueEndpointMaps = new Map<
    string,
    Map<
      string,
      {
        method?: string;
        badge?: string;
        path: string;
        count: number;
        durationSum: number;
        measured: number;
        token?: string;
      }
    >
  >();

  for (const s of summaries) {
    byType[s.type] = (byType[s.type] ?? 0) + 1;
    if (s.method) byMethod[s.method] = (byMethod[s.method] ?? 0) + 1;
    if (s.statusCode !== undefined) {
      const bucket = statusClass(s.statusCode);
      if (bucket) byStatusClass[bucket]++;
    }
    if (isError(s)) errorCount++;

    const ep = describeEndpoint(s);
    const key = endpointKey(s, ep);
    const group = groups.get(key) ?? {
      method: ep.method,
      badge: ep.badge,
      path: ep.path,
      calls: 0,
      durationSum: 0,
      measured: 0,
    };
    group.calls++;
    if (s.duration > 0) {
      group.durationSum += s.duration;
      group.measured++;
    }
    groups.set(key, group);

    for (const id of s.tags.trim().split(/\s+/)) {
      if (id === '' || id === ERROR_TAG_ID) continue;
      issues[id] = (issues[id] ?? 0) + 1;
      let byEndpoint = issueEndpointMaps.get(id);
      if (!byEndpoint) {
        byEndpoint = new Map();
        issueEndpointMaps.set(id, byEndpoint);
      }
      const affected = byEndpoint.get(key) ?? {
        method: ep.method,
        badge: ep.badge,
        path: ep.path,
        count: 0,
        durationSum: 0,
        measured: 0,
        // `summaries` is newest-first, so the first row seen for this endpoint is the most recent.
        token: s.token,
      };
      affected.count++;
      if (s.duration > 0) {
        affected.durationSum += s.duration;
        affected.measured++;
      }
      byEndpoint.set(key, affected);
    }
  }

  const topSlowEndpoints: SlowEndpoint[] = [...groups.values()]
    .map((g) => ({
      method: g.method,
      badge: g.badge,
      path: g.path,
      calls: g.calls,
      avg: g.measured === 0 ? 0 : g.durationSum / g.measured,
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, topN);

  // `summaries` arrives newest-first (the query's default sort), so recent errors keep that order.
  const recentErrors: RecentError[] = summaries
    .filter(isError)
    .slice(0, topN)
    .map((s) => {
      const ep = describeEndpoint(s);
      return {
        token: s.token,
        method: ep.method,
        badge: ep.badge,
        path: ep.path,
        statusCode: s.statusCode,
        at: s.createdAt,
      };
    });

  const issueEndpoints: Record<string, EndpointCount[]> = {};
  for (const [id, byEndpoint] of issueEndpointMaps) {
    issueEndpoints[id] = [...byEndpoint.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, topN)
      .map((e) => ({
        method: e.method,
        badge: e.badge,
        path: e.path,
        count: e.count,
        avg: e.measured === 0 ? 0 : e.durationSum / e.measured,
        token: e.token,
      }));
  }

  return {
    sampled,
    duration: {
      avg,
      p50: percentile(measuredDurations, 50),
      p95: percentile(measuredDurations, 95),
      p99: percentile(measuredDurations, 99),
    },
    errors: { count: errorCount, rate: sampled === 0 ? 0 : errorCount / sampled },
    byMethod,
    byStatusClass,
    issues,
    topSlowEndpoints,
    recentErrors,
    byType,
    timeline: buildTimeline(summaries, isError),
    issueEndpoints,
    heap: buildHeap(summaries),
    topN,
  };
}
