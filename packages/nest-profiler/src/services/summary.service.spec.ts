import { SummaryService } from './summary.service';
import type { ProfilerStorageService } from './profiler-storage.service';
import type { ProfileSummary } from '../storage/profile-summary';
import type { ProfilerQuery } from '../storage/profiler-query';

function row(over: Partial<ProfileSummary> = {}): ProfileSummary {
  return {
    token: over.token ?? 't',
    createdAt: over.createdAt ?? Date.now(),
    type: 'http',
    method: over.method ?? 'GET',
    url: over.url ?? '/x',
    statusCode: over.statusCode ?? 200,
    route: over.route,
    duration: over.duration ?? 10,
    heapUsed: over.heapUsed ?? 0,
    hasExceptions: over.hasExceptions ?? false,
    tags: over.tags ?? '',
    search: '',
    attributes: {},
  };
}

describe('SummaryService', () => {
  let querySummaries: jest.Mock;
  let findAll: jest.Mock;
  let service: SummaryService;

  beforeEach(() => {
    querySummaries = jest.fn().mockResolvedValue([row({ duration: 100 })]);
    findAll = jest.fn().mockResolvedValue([]);
    const storage = { querySummaries, findAll } as unknown as ProfilerStorageService;
    service = new SummaryService(storage);
  });

  it('computes the summary from a single bounded querySummaries read (never findAll)', async () => {
    const result = await service.getSummary();

    expect(querySummaries).toHaveBeenCalledTimes(1);
    const [arg] = querySummaries.mock.calls[0] as [ProfilerQuery];
    expect(arg.filters).toEqual([]);
    expect(arg.page).toBe(1);
    expect(arg.pageSize).toBeGreaterThan(0);
    // The Summary path must never load full profiles.
    expect(findAll).not.toHaveBeenCalled();
    expect(result.sampled).toBe(1);
    expect(result.duration.avg).toBe(100);
  });

  it('serves a cached summary within the TTL, recomputing only after it expires', async () => {
    await service.getSummary();
    await service.getSummary();
    // Second call is a cache hit — the store is queried once.
    expect(querySummaries).toHaveBeenCalledTimes(1);

    // Advance past the ~30s TTL.
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    try {
      await service.getSummary();
      expect(querySummaries).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('honours a configured window size', async () => {
    const storage = { querySummaries, findAll } as unknown as ProfilerStorageService;
    const svc = new SummaryService(storage, undefined, { summary: { windowSize: 250 } });
    await svc.getSummary();
    const [arg] = querySummaries.mock.calls[0] as [ProfilerQuery];
    expect(arg.pageSize).toBe(250);
  });

  it('recomputes on every load when the cache TTL is disabled (0)', async () => {
    const storage = { querySummaries, findAll } as unknown as ProfilerStorageService;
    const svc = new SummaryService(storage, undefined, { summary: { cacheTtl: 0 } });
    await svc.getSummary();
    await svc.getSummary();
    expect(querySummaries).toHaveBeenCalledTimes(2);
  });

  describe('getDomainSections', () => {
    it('returns [] and runs no query when no collector contributes', async () => {
      const query = jest.fn();
      const storage = { querySummaries, query } as unknown as ProfilerStorageService;
      const registry = {
        hasSummaryContributors: () => false,
        buildSummarySections: jest.fn(),
      } as unknown as import('../collectors/collector-registry.service').CollectorRegistry;
      const svc = new SummaryService(storage, registry);
      expect(await svc.getDomainSections()).toEqual([]);
      expect(query).not.toHaveBeenCalled();
    });

    it('builds sections from a bounded full-profile window when a collector contributes', async () => {
      const sections = [{ name: 'db', label: 'Database', tiles: [] }];
      const buildSummarySections = jest.fn().mockReturnValue(sections);
      const query = jest.fn().mockResolvedValue({ items: [{ token: 'a' }], total: 1 });
      const storage = { querySummaries, query } as unknown as ProfilerStorageService;
      const registry = {
        hasSummaryContributors: () => true,
        buildSummarySections,
      } as unknown as import('../collectors/collector-registry.service').CollectorRegistry;
      const svc = new SummaryService(storage, registry);

      const result = await svc.getDomainSections();

      expect(query).toHaveBeenCalledTimes(1);
      const [arg] = query.mock.calls[0] as [ProfilerQuery];
      expect(arg.page).toBe(1);
      expect(arg.pageSize).toBeGreaterThan(0);
      expect(buildSummarySections).toHaveBeenCalledWith([{ token: 'a' }], 5);
      expect(result).toBe(sections);
      // Second call is cached — no extra query.
      await svc.getDomainSections();
      expect(query).toHaveBeenCalledTimes(1);
    });
  });
});
