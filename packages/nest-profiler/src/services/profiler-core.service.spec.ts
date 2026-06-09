import { Test } from '@nestjs/testing';
import { ProfilerCoreService } from './profiler-core.service';
import { ProfilerStorageService } from './profiler-storage.service';
import { CollectorRegistry } from '../collectors/collector-registry.service';
import { RouteCollector } from '../collectors/route.collector';
import type { IContextAdapter } from '../adapters/context-adapter.interface';
import type { Profile } from '../interfaces/profile.interface';
import type { ProfilerListFilter } from '../list-filters/profiler-list-filter.interface';
import { BUILTIN_LIST_FILTERS } from '../list-filters/builtin-filters';

function makeProfile(): Profile {
  return {
    token: 'tok',
    createdAt: Date.now(),
    request: { method: 'POST', url: '/graphql', headers: {}, query: {} },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

describe('ProfilerCoreService', () => {
  it('exposes the injected storage, collector registry and route collector', async () => {
    const storage = { findAll: jest.fn() } as unknown as ProfilerStorageService;
    const collectorRegistry = { buildPanels: jest.fn() } as unknown as CollectorRegistry;
    const routeCollector = { match: jest.fn() } as unknown as RouteCollector;

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProfilerCoreService,
        { provide: ProfilerStorageService, useValue: storage },
        { provide: CollectorRegistry, useValue: collectorRegistry },
        { provide: RouteCollector, useValue: routeCollector },
      ],
    }).compile();

    const core = moduleRef.get(ProfilerCoreService);
    expect(core.storage).toBe(storage);
    expect(core.collectorRegistry).toBe(collectorRegistry);
    expect(core.routeCollector).toBe(routeCollector);
  });

  describe('context adapter registry', () => {
    let core: ProfilerCoreService;

    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          ProfilerCoreService,
          { provide: ProfilerStorageService, useValue: { findAll: jest.fn() } },
          { provide: CollectorRegistry, useValue: { buildPanels: jest.fn() } },
          { provide: RouteCollector, useValue: { match: jest.fn() } },
        ],
      }).compile();
      core = moduleRef.get(ProfilerCoreService);
    });

    it('registerContextAdapter stores and findContextAdapter retrieves by type', () => {
      const adapter: IContextAdapter = {
        contextType: 'graphql',
        recoverProfile: jest.fn(),
        enrichProfile: jest.fn(),
      };

      core.registerContextAdapter(adapter);

      expect(core.findContextAdapter('graphql')).toBe(adapter);
    });

    it('does not register the same contextType twice', () => {
      const adapter1: IContextAdapter = {
        contextType: 'graphql',
        recoverProfile: jest.fn(),
        enrichProfile: jest.fn(),
      };
      const adapter2: IContextAdapter = {
        contextType: 'graphql',
        recoverProfile: jest.fn(),
        enrichProfile: jest.fn(),
      };

      core.registerContextAdapter(adapter1);
      core.registerContextAdapter(adapter2);

      expect(core.findContextAdapter('graphql')).toBe(adapter1);
    });

    it('findContextAdapter returns undefined for unknown context type', () => {
      expect(core.findContextAdapter('unknown')).toBeUndefined();
    });

    it('enrichHttpResponse calls enrichHttpResponse on all adapters that implement it', () => {
      const enrichFn = jest.fn();
      const adapter: IContextAdapter = {
        contextType: 'graphql',
        recoverProfile: jest.fn(),
        enrichProfile: jest.fn(),
        enrichHttpResponse: enrichFn,
      };
      core.registerContextAdapter(adapter);

      const profile = makeProfile();
      const req = { body: { query: '{ books { id } }' } };
      const responseBody = { data: { books: [] } };

      core.enrichHttpResponse(profile, req, responseBody);

      expect(enrichFn).toHaveBeenCalledWith(profile, req, responseBody);
    });

    it('enrichHttpResponse skips adapters without enrichHttpResponse method', () => {
      const adapter: IContextAdapter = {
        contextType: 'graphql',
        recoverProfile: jest.fn(),
        enrichProfile: jest.fn(),
        // no enrichHttpResponse
      };
      core.registerContextAdapter(adapter);

      const profile = makeProfile();

      expect(() => core.enrichHttpResponse(profile, {}, {})).not.toThrow();
    });
  });

  describe('list filter registry', () => {
    let core: ProfilerCoreService;

    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          ProfilerCoreService,
          { provide: ProfilerStorageService, useValue: { findAll: jest.fn() } },
          { provide: CollectorRegistry, useValue: { buildPanels: jest.fn() } },
          { provide: RouteCollector, useValue: { match: jest.fn() } },
        ],
      }).compile();
      core = moduleRef.get(ProfilerCoreService);
    });

    const customFilter: ProfilerListFilter<boolean> = {
      key: 'custom',
      label: 'Custom',
      control: 'checkbox',
      order: 5,
      parse: (raw) => (raw ? true : undefined),
      matches: () => true,
    };

    it('seeds the built-in filters', () => {
      const keys = core.getListFilters().map((f) => f.key);
      expect(keys).toEqual(expect.arrayContaining(BUILTIN_LIST_FILTERS.map((f) => f.key)));
    });

    it('registerListFilter adds a contributed filter', () => {
      core.registerListFilter(customFilter);
      expect(core.getListFilters().some((f) => f.key === 'custom')).toBe(true);
    });

    it('does not register the same key twice', () => {
      core.registerListFilter(customFilter);
      core.registerListFilter({ ...customFilter, label: 'Other' });
      const matches = core.getListFilters().filter((f) => f.key === 'custom');
      expect(matches).toHaveLength(1);
      expect(matches[0]?.label).toBe('Custom');
    });

    it('returns filters sorted by ascending order', () => {
      core.registerListFilter(customFilter); // order 5 — before all built-ins
      const orders = core.getListFilters().map((f) => f.order ?? 100);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
      expect(core.getListFilters()[0]?.key).toBe('custom');
    });

    it('registerFilterOption merges options into an existing select filter', () => {
      core.registerFilterOption('type', { value: 'graphql', label: 'GraphQL' });
      const typeFilter = core.getListFilters().find((f) => f.key === 'type');
      expect(typeFilter?.options?.map((o) => o.value)).toContain('graphql');
    });

    it('does not add the same option value twice', () => {
      core.registerFilterOption('type', { value: 'graphql', label: 'GraphQL' });
      core.registerFilterOption('type', { value: 'graphql', label: 'GQL' });
      const typeFilter = core.getListFilters().find((f) => f.key === 'type');
      const graphqlOptions = typeFilter?.options?.filter((o) => o.value === 'graphql');
      expect(graphqlOptions).toHaveLength(1);
    });
  });
});
