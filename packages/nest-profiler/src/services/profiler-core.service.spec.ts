import { Test } from '@nestjs/testing';
import { ProfilerCoreService } from './profiler-core.service';
import { ProfilerStorageService } from './profiler-storage.service';
import { CollectorRegistry } from '../collectors/collector-registry.service';
import { RouteCollector } from '../collectors/route.collector';
import type { IContextAdapter } from '../adapters/context-adapter.interface';
import type { Profile } from '../interfaces/profile.interface';
import type { ProfilerListFilter } from '../list-filters/profiler-list-filter.interface';
import { BUILTIN_LIST_FILTERS } from '../list-filters/builtin-filters';
import type { ProfilerListSection } from '../list-sections/profiler-list-section.interface';
import type { ProfilerEntrypointType } from '../entrypoints/profiler-entrypoint-type.interface';

function makeProfile(): Profile {
  return {
    token: 'tok',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'POST', url: '/graphql', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

describe('ProfilerCoreService', () => {
  it('exposes the injected storage, collector registry and route collector', async () => {
    const storage = {
      findAll: jest.fn(),
      setIndexAttributesProvider: jest.fn(),
    } as unknown as ProfilerStorageService;
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
          {
            provide: ProfilerStorageService,
            useValue: { findAll: jest.fn(), setIndexAttributesProvider: jest.fn() },
          },
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

  describe('deferred persistence', () => {
    let core: ProfilerCoreService;
    let save: jest.Mock;
    let collectAll: jest.Mock;

    beforeEach(async () => {
      save = jest.fn().mockResolvedValue(undefined);
      collectAll = jest.fn().mockResolvedValue(undefined);
      const moduleRef = await Test.createTestingModule({
        providers: [
          ProfilerCoreService,
          {
            provide: ProfilerStorageService,
            useValue: { save, setIndexAttributesProvider: jest.fn() },
          },
          { provide: CollectorRegistry, useValue: { collectAll } },
          { provide: RouteCollector, useValue: { match: jest.fn() } },
        ],
      }).compile();
      core = moduleRef.get(ProfilerCoreService);
    });

    it('schedulePersist runs collectors then saves, drained by flushPendingProfiles', async () => {
      const profile = makeProfile();

      core.schedulePersist(profile);
      await core.flushPendingProfiles();

      expect(collectAll).toHaveBeenCalledWith(profile);
      expect(save).toHaveBeenCalledWith(profile);
    });

    it('schedulePersist returns before collectors complete', () => {
      collectAll.mockReturnValue(new Promise(() => undefined)); // never resolves

      core.schedulePersist(makeProfile());

      expect(collectAll).toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    });

    it('scheduleSave saves without re-running collectors', async () => {
      const profile = makeProfile();

      core.scheduleSave(profile);
      await core.flushPendingProfiles();

      expect(save).toHaveBeenCalledWith(profile);
      expect(collectAll).not.toHaveBeenCalled();
    });

    it('flushPendingProfiles drains work scheduled while it is flushing', async () => {
      const first = makeProfile();
      const second = makeProfile();
      collectAll.mockImplementationOnce(() => {
        core.scheduleSave(second);
        return Promise.resolve();
      });

      core.schedulePersist(first);
      await core.flushPendingProfiles();

      expect(save).toHaveBeenCalledWith(first);
      expect(save).toHaveBeenCalledWith(second);
    });

    it('a failing save never rejects out of the deferred pipeline', async () => {
      save.mockRejectedValue(new Error('disk full'));

      core.schedulePersist(makeProfile());

      await expect(core.flushPendingProfiles()).resolves.toBeUndefined();
    });

    it('onApplicationShutdown drains pending saves', async () => {
      const profile = makeProfile();
      core.schedulePersist(profile);

      await core.onApplicationShutdown();

      expect(save).toHaveBeenCalledWith(profile);
    });
  });

  describe('list filter registry', () => {
    let core: ProfilerCoreService;

    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          ProfilerCoreService,
          {
            provide: ProfilerStorageService,
            useValue: { findAll: jest.fn(), setIndexAttributesProvider: jest.fn() },
          },
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
      toCriterion: () => ({ field: 'hasExceptions', op: 'truthy' }),
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
      core.registerFilterOption('statusClass', { value: '9', label: '9xx' });
      const statusClass = core.getListFilters().find((f) => f.key === 'statusClass');
      expect(statusClass?.options?.map((o) => o.value)).toContain('9');
    });

    it('does not add the same option value twice', () => {
      core.registerFilterOption('statusClass', { value: '9', label: '9xx' });
      core.registerFilterOption('statusClass', { value: '9', label: 'nine' });
      const statusClass = core.getListFilters().find((f) => f.key === 'statusClass');
      const dupes = statusClass?.options?.filter((o) => o.value === '9');
      expect(dupes).toHaveLength(1);
    });
  });

  describe('list section registry', () => {
    let core: ProfilerCoreService;

    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          ProfilerCoreService,
          {
            provide: ProfilerStorageService,
            useValue: { findAll: jest.fn(), setIndexAttributesProvider: jest.fn() },
          },
          { provide: CollectorRegistry, useValue: { buildPanels: jest.fn() } },
          { provide: RouteCollector, useValue: { match: jest.fn() } },
        ],
      }).compile();
      core = moduleRef.get(ProfilerCoreService);
    });

    const customSection: ProfilerListSection = {
      key: 'messages',
      title: 'Messages',
      order: 5,
      templatePath: '/tmp/messages.ejs',
    };

    it('seeds the built-in HTTP section as the default', () => {
      const sections = core.getListSections();
      const http = sections.find((s) => s.key === 'http');
      expect(http).toBeDefined();
      expect(http?.isDefault).toBe(true);
    });

    it('registerListSection adds a contributed section', () => {
      core.registerListSection(customSection);
      expect(core.getListSections().some((s) => s.key === 'messages')).toBe(true);
    });

    it('does not register the same key twice', () => {
      core.registerListSection(customSection);
      core.registerListSection({ ...customSection, title: 'Other' });
      const matches = core.getListSections().filter((s) => s.key === 'messages');
      expect(matches).toHaveLength(1);
      expect(matches[0]?.title).toBe('Messages');
    });

    it('returns sections sorted by ascending order', () => {
      core.registerListSection(customSection); // order 5 — before the built-ins
      const orders = core.getListSections().map((s) => s.order ?? 100);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
      expect(core.getListSections()[0]?.key).toBe('messages');
    });
  });

  describe('entrypoint type registry', () => {
    let core: ProfilerCoreService;

    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          ProfilerCoreService,
          {
            provide: ProfilerStorageService,
            useValue: { findAll: jest.fn(), setIndexAttributesProvider: jest.fn() },
          },
          { provide: CollectorRegistry, useValue: { buildPanels: jest.fn() } },
          { provide: RouteCollector, useValue: { match: jest.fn() } },
        ],
      }).compile();
      core = moduleRef.get(ProfilerCoreService);
    });

    const demoType: ProfilerEntrypointType = {
      type: 'demo',
      label: 'Demo',
      listSection: {
        title: 'Demo',
        templatePath: '/tmp/x.ejs',
        order: 50,
        itemLabel: 'demo',
      },
      detailTabs: [{ name: 'demo', label: 'Demo', templatePath: '/tmp/x.ejs' }],
      listFilters: [
        {
          key: 'demoFilter',
          label: 'Demo',
          control: 'text',
          parse: (raw) => (raw && raw.length > 0 ? raw : undefined),
          toCriterion: (value) => ({ field: 'search', op: 'contains', value }),
        },
      ],
      summary: () => ({ badge: 'D', text: 'x' }),
    };

    it('registerEntrypointType derives a list section keyed by the type', () => {
      core.registerEntrypointType(demoType);
      expect(core.getListSections().some((s) => s.key === 'demo')).toBe(true);
    });

    it('getEntrypointType returns the registered type', () => {
      core.registerEntrypointType(demoType);
      expect(core.getEntrypointType('demo')).toBe(demoType);
    });

    it('getEntrypointType falls back to the built-in http type for an unknown type', () => {
      const fallback = core.getEntrypointType('nope');
      expect(fallback.type).toBe('http');
    });

    it('registerEntrypointType registers the kind-scoped list filters', () => {
      core.registerEntrypointType(demoType);
      const scoped = core.getListFilters().find((f) => f.key === 'demoFilter');
      expect(scoped).toBeDefined();
      expect(scoped?.forType).toBe('demo');
    });
  });
});
