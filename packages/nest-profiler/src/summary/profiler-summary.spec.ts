import { computeProfilerSummary, defaultIsError, resolveErrorClassifier } from './profiler-summary';
import type { ProfileSummary } from '../storage/profile-summary';

function summary(over: Partial<ProfileSummary> = {}): ProfileSummary {
  return {
    token: over.token ?? Math.random().toString(36).slice(2),
    createdAt: over.createdAt ?? Date.now(),
    type: over.type ?? 'http',
    method: over.method,
    url: over.url,
    statusCode: over.statusCode,
    route: over.route,
    duration: over.duration ?? 0,
    heapUsed: over.heapUsed ?? 0,
    hasExceptions: over.hasExceptions ?? false,
    tags: over.tags ?? '',
    search: over.search ?? '',
    attributes: over.attributes ?? {},
  };
}

describe('computeProfilerSummary', () => {
  it('returns a well-formed, zeroed summary for an empty window', () => {
    const result = computeProfilerSummary([]);
    expect(result).toEqual({
      sampled: 0,
      duration: { avg: 0, p50: 0, p95: 0, p99: 0 },
      errors: { count: 0, rate: 0 },
      byMethod: {},
      byStatusClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
      issues: {},
      topSlowEndpoints: [],
      recentErrors: [],
      byType: {},
      timeline: [],
      issueEndpoints: {},
      heap: null,
      topN: 5,
    });
  });

  it('summarizes the process heap (current/min/max) and flags a rising trend as a leak', () => {
    const t0 = 1_000_000;
    const MB = 1024 * 1024;
    // Oldest → newest heap climbing from ~50MB to ~80MB (a >5MB delta → leak).
    const rows = Array.from({ length: 10 }, (_, i) =>
      summary({ createdAt: t0 + i, heapUsed: (50 + i * 3) * MB, duration: 5 }),
    );
    const result = computeProfilerSummary(rows);
    expect(result.heap).not.toBeNull();
    expect(result.heap?.current).toBe(77 * MB);
    expect(result.heap?.min).toBe(50 * MB);
    expect(result.heap?.max).toBe(77 * MB);
    expect(result.heap?.trend).toBe('leak');
    // The sparkline series is oldest → newest.
    expect(result.heap?.series).toHaveLength(10);
    expect(result.heap?.series?.[0]).toBe(50 * MB);
    expect(result.heap?.series?.[9]).toBe(77 * MB);
  });

  it('reports no heap when nothing carried a reading', () => {
    const result = computeProfilerSummary([summary({ heapUsed: 0 }), summary({ heapUsed: 0 })]);
    expect(result.heap).toBeNull();
  });

  it('counts profiles per entrypoint kind (byType)', () => {
    const result = computeProfilerSummary([
      summary({ type: 'http' }),
      summary({ type: 'http' }),
      summary({ type: 'graphql' }),
      summary({ type: 'command' }),
    ]);
    expect(result.byType).toEqual({ http: 2, graphql: 1, command: 1 });
  });

  it('buckets the window over time with per-bucket count, errors and p95', () => {
    const t0 = 1_000_000;
    // 3 samples → bucket count capped at 3; a gap in the middle stays empty.
    const result = computeProfilerSummary([
      summary({ createdAt: t0, duration: 10 }),
      summary({ createdAt: t0 + 10, duration: 20, statusCode: 500 }),
      summary({ createdAt: t0 + 2000, duration: 300 }),
    ]);
    expect(result.timeline.length).toBe(3);
    const total = result.timeline.reduce((n, b) => n + b.count, 0);
    const errs = result.timeline.reduce((n, b) => n + b.errorCount, 0);
    expect(total).toBe(3);
    expect(errs).toBe(1);
    expect(result.timeline[0]?.count).toBe(2);
    expect(result.timeline[1]?.count).toBe(0); // the middle slice has no traffic
    expect(result.timeline[2]?.count).toBe(1);
    expect(result.timeline[2]?.p95).toBe(300);
  });

  it('caps the timeline bucket count at 24 for a large window', () => {
    const rows = Array.from({ length: 200 }, (_, i) =>
      summary({ createdAt: 1_000_000 + i * 1000, duration: 5 }),
    );
    expect(computeProfilerSummary(rows).timeline).toHaveLength(24);
  });

  it('collapses an instant window into a single timeline bucket', () => {
    const result = computeProfilerSummary([
      summary({ createdAt: 5, duration: 1 }),
      summary({ createdAt: 5, duration: 2 }),
    ]);
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]).toMatchObject({ count: 2, errorCount: 0 });
  });

  it('correlates each issue with the affected endpoints and a representative profile token', () => {
    // Newest-first input, so the first row seen for an (issue, endpoint) sets its token.
    const result = computeProfilerSummary([
      summary({ token: 'a1', method: 'GET', route: '/a', tags: ' n-plus-one ', duration: 50 }),
      summary({ token: 'a2', method: 'GET', route: '/a', tags: ' n-plus-one slow ', duration: 90 }),
      summary({ token: 'b1', method: 'GET', route: '/b', tags: ' n-plus-one ', duration: 40 }),
      summary({ token: 'c1', method: 'POST', route: '/c', tags: ' slow chatty ', duration: 10 }),
    ]);
    // One entry per tag id, each ranked by occurrence; the `error` tag is never an issue.
    expect(result.issueEndpoints['n-plus-one']).toEqual([
      { method: 'GET', badge: 'GET', path: '/a', count: 2, avg: 70, token: 'a1' },
      { method: 'GET', badge: 'GET', path: '/b', count: 1, avg: 40, token: 'b1' },
    ]);
    expect(result.issueEndpoints['slow']).toEqual([
      { method: 'GET', badge: 'GET', path: '/a', count: 1, avg: 90, token: 'a2' },
      { method: 'POST', badge: 'POST', path: '/c', count: 1, avg: 10, token: 'c1' },
    ]);
    expect(result.issueEndpoints['chatty']).toEqual([
      { method: 'POST', badge: 'POST', path: '/c', count: 1, avg: 10, token: 'c1' },
    ]);
  });

  it('caps every table at the configured topN (and echoes it), defaulting to 5', () => {
    // Ten distinct slow HTTP routes, each failing and carrying the same performance tag.
    const rows = Array.from({ length: 10 }, (_, i) =>
      summary({
        token: `t${i}`,
        method: 'GET',
        route: `/r${i}`,
        statusCode: 500,
        duration: 100 + i,
        tags: ' slow ',
      }),
    );
    expect(computeProfilerSummary(rows).topN).toBe(5);
    expect(computeProfilerSummary(rows).topSlowEndpoints).toHaveLength(5);

    const top3 = computeProfilerSummary(rows, { topN: 3 });
    expect(top3.topN).toBe(3);
    expect(top3.topSlowEndpoints).toHaveLength(3);
    expect(top3.recentErrors).toHaveLength(3);
    expect(top3.issueEndpoints['slow']).toHaveLength(3);

    // Clamped to at least 1 (a zero/negative/fractional cap never empties a table).
    expect(computeProfilerSummary(rows, { topN: 0 }).topN).toBe(1);
    expect(computeProfilerSummary(rows, { topN: -4 }).topSlowEndpoints).toHaveLength(1);
  });

  describe('error classification', () => {
    it('defaults to a 5xx status or a captured exception (4xx is not an error)', () => {
      expect(defaultIsError(summary({ statusCode: 500 }))).toBe(true);
      expect(defaultIsError(summary({ statusCode: 404 }))).toBe(false);
      expect(defaultIsError(summary({ statusCode: 200, hasExceptions: true }))).toBe(true);
      // No config resolves to exactly the default.
      expect(resolveErrorClassifier()).toBe(defaultIsError);
    });

    it('honours a configured HTTP status bound and the exceptions toggle', () => {
      const includes4xx = resolveErrorClassifier({ httpStatus: 400 });
      expect(includes4xx(summary({ statusCode: 404 }))).toBe(true);
      expect(includes4xx(summary({ statusCode: 302 }))).toBe(false);

      const predicate = resolveErrorClassifier({ httpStatus: (c) => c === 429 || c >= 500 });
      expect(predicate(summary({ statusCode: 429 }))).toBe(true);
      expect(predicate(summary({ statusCode: 404 }))).toBe(false);

      const ignoreExceptions = resolveErrorClassifier({ exceptions: false });
      expect(ignoreExceptions(summary({ statusCode: 200, hasExceptions: true }))).toBe(false);
    });

    it('lets a classify predicate qualify a kind without a status code, then defers on undefined', () => {
      const classify = resolveErrorClassifier({
        classify: (info) =>
          info.type === 'command' ? info.attributes.commandExitCode !== 0 : undefined,
      });
      // Non-HTTP kind qualified from its own attributes.
      expect(classify(summary({ type: 'command', attributes: { commandExitCode: 1 } }))).toBe(true);
      expect(classify(summary({ type: 'command', attributes: { commandExitCode: 0 } }))).toBe(
        false,
      );
      // undefined verdict defers to the default 5xx/exception layer.
      expect(classify(summary({ type: 'http', statusCode: 500 }))).toBe(true);
      expect(classify(summary({ type: 'http', statusCode: 404 }))).toBe(false);
    });

    it('feeds the resolved classifier through the error rate, recent errors and timeline', () => {
      const rows = [
        summary({ token: 'e1', statusCode: 404, createdAt: 2, method: 'GET', route: '/a' }),
        summary({ token: 'ok', statusCode: 200, createdAt: 1, method: 'GET', route: '/b' }),
      ];
      // Default: the 404 is not an error.
      const base = computeProfilerSummary(rows);
      expect(base.errors.count).toBe(0);
      expect(base.recentErrors).toHaveLength(0);
      // Opt 4xx in: now the 404 counts everywhere.
      const with4xx = computeProfilerSummary(rows, {
        isError: resolveErrorClassifier({ httpStatus: 400 }),
      });
      expect(with4xx.errors.count).toBe(1);
      expect(with4xx.recentErrors).toHaveLength(1);
      expect(with4xx.timeline.reduce((n, b) => n + b.errorCount, 0)).toBe(1);
    });
  });

  it('excludes the duration===0 sentinel from avg and percentiles', () => {
    const result = computeProfilerSummary([
      summary({ duration: 0, method: 'GET', statusCode: 200 }),
      summary({ duration: 100, method: 'GET', statusCode: 200 }),
      summary({ duration: 200, method: 'GET', statusCode: 200 }),
    ]);
    // Only the two measured durations feed the stats — the 0 would otherwise deflate them.
    expect(result.sampled).toBe(3);
    expect(result.duration.avg).toBe(150);
    expect(result.duration.p50).toBe(100);
    expect(result.duration.p95).toBe(200);
  });

  it('counts errors as a 5xx status or a captured exception, with a rate over the whole window', () => {
    const result = computeProfilerSummary([
      summary({ statusCode: 200 }),
      summary({ statusCode: 500 }),
      summary({ statusCode: 200, hasExceptions: true }), // GraphQL-style 200 + error
    ]);
    expect(result.errors.count).toBe(2);
    expect(result.errors.rate).toBeCloseTo(2 / 3);
  });

  it('tallies methods and status classes only for profiles that carry them', () => {
    const result = computeProfilerSummary([
      summary({ method: 'GET', statusCode: 200 }),
      summary({ method: 'POST', statusCode: 404 }),
      summary({ method: 'GET', statusCode: 301 }),
      // A non-HTTP kind (no method/status) still counts toward `sampled` but not the distributions.
      summary({ type: 'command' }),
    ]);
    expect(result.sampled).toBe(4);
    expect(result.byMethod).toEqual({ GET: 2, POST: 1 });
    expect(result.byStatusClass).toEqual({ '2xx': 1, '3xx': 1, '4xx': 1, '5xx': 0 });
  });

  it('counts performance-tag issues dynamically, excluding the error tag', () => {
    const result = computeProfilerSummary([
      summary({ tags: ' slow n-plus-one ' }),
      summary({ tags: ' slow ' }),
      summary({ tags: ' error ', statusCode: 500 }),
    ]);
    // `error` is reported via `errors`, never as a performance issue.
    expect(result.issues).toEqual({ slow: 2, 'n-plus-one': 1 });
  });

  it('groups slowest endpoints by route (falling back to method+url) and ranks by avg', () => {
    const result = computeProfilerSummary([
      summary({ method: 'GET', url: '/users/1', route: '/users/:id', duration: 100 }),
      summary({ method: 'GET', url: '/users/2', route: '/users/:id', duration: 300 }),
      summary({ method: 'GET', url: '/health', duration: 10 }),
    ]);
    // The two /users/:id calls collapse into one bucket (avg 200), ranked above /health.
    expect(result.topSlowEndpoints).toEqual([
      { method: 'GET', badge: 'GET', path: '/users/:id', calls: 2, avg: 200 },
      // No route → grouped by URL; the method rides in the badge, not the path.
      { method: 'GET', badge: 'GET', path: '/health', calls: 1, avg: 10 },
    ]);
  });

  it('keeps the same URL under different methods as distinct endpoints', () => {
    const result = computeProfilerSummary([
      summary({ method: 'GET', url: '/items', duration: 10 }),
      summary({ method: 'POST', url: '/items', duration: 20 }),
    ]);
    expect(result.topSlowEndpoints).toEqual([
      { method: 'POST', badge: 'POST', path: '/items', calls: 1, avg: 20 },
      { method: 'GET', badge: 'GET', path: '/items', calls: 1, avg: 10 },
    ]);
  });

  it('labels non-HTTP endpoints from their entrypoint descriptor (command, message, GraphQL)', () => {
    // The core contributes `endpoint`/`endpointBadge` on non-HTTP kinds (no method/url/route).
    const result = computeProfilerSummary([
      summary({
        type: 'command',
        duration: 20,
        attributes: { endpoint: 'demo:greet', endpointBadge: 'CLI' },
      }),
      summary({
        type: 'command',
        duration: 4,
        attributes: { endpoint: 'demo:greet', endpointBadge: 'CLI' },
      }),
      summary({
        type: 'rabbitmq',
        duration: 30,
        attributes: { endpoint: 'orders → order.created', endpointBadge: 'RMQ' },
      }),
      summary({
        type: 'graphql',
        method: 'POST',
        url: '/graphql',
        duration: 12,
        attributes: { endpoint: 'QUERY products', endpointBadge: 'GQL' },
      }),
    ]);
    // Each non-HTTP kind groups by its own label (never a blank row); the two commands collapse.
    expect(result.topSlowEndpoints).toEqual([
      { method: undefined, badge: 'RMQ', path: 'orders → order.created', calls: 1, avg: 30 },
      { method: undefined, badge: 'CLI', path: 'demo:greet', calls: 2, avg: 12 },
      // GraphQL groups by its operation, not by the HTTP transport (POST /graphql).
      { method: undefined, badge: 'GQL', path: 'QUERY products', calls: 1, avg: 12 },
    ]);
  });

  it('gives a failed command a labelled recent-error row (never blank)', () => {
    const result = computeProfilerSummary([
      summary({
        token: 'cmd1',
        type: 'command',
        statusCode: 500,
        hasExceptions: true,
        attributes: { endpoint: 'demo:greet --fail', endpointBadge: 'CLI' },
      }),
    ]);
    expect(result.recentErrors[0]).toMatchObject({
      token: 'cmd1',
      method: undefined,
      badge: 'CLI',
      path: 'demo:greet --fail',
    });
  });

  it('lists the most recent errors newest-first, capped at five', () => {
    const base = Date.now();
    // Newest-first input (as querySummaries returns): 6 errors interleaved with an OK.
    const rows = [
      summary({ token: 'e6', createdAt: base + 6, statusCode: 500, method: 'GET', route: '/f' }),
      summary({ token: 'ok', createdAt: base + 5, statusCode: 200 }),
      summary({ token: 'e5', createdAt: base + 4, hasExceptions: true, method: 'POST', url: '/e' }),
      summary({ token: 'e4', createdAt: base + 3, statusCode: 503 }),
      summary({ token: 'e3', createdAt: base + 2, statusCode: 500 }),
      summary({ token: 'e2', createdAt: base + 1, statusCode: 500 }),
      summary({ token: 'e1', createdAt: base, statusCode: 500 }),
    ];
    const result = computeProfilerSummary(rows);
    expect(result.recentErrors.map((e) => e.token)).toEqual(['e6', 'e5', 'e4', 'e3', 'e2']);
    expect(result.recentErrors[0]).toMatchObject({ method: 'GET', path: '/f', statusCode: 500 });
    // An exception with no status still surfaces, keyed by its url when it has no route.
    expect(result.recentErrors[1]).toMatchObject({ path: '/e', statusCode: undefined });
  });
});
