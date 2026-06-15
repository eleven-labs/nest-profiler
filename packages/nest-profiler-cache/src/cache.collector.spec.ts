import * as path from 'path';
import type { ClsService } from 'nestjs-cls';
import { CacheCollector } from './cache.collector';
import { CacheCollectorModule } from './cache-collector.module';
import { CacheManagerPatch } from './cache-manager.patch';
import { CACHE_OPERATIONS_KEY } from './cache-collector.interface';
import type { Profile } from '@eleven-labs/nest-profiler';
import type { CacheOperationEntry } from './cache-collector.interface';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    token: 'test',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
    ...overrides,
  };
}

function makeOp(
  operation: CacheOperationEntry['operation'],
  key = 'test-key',
): CacheOperationEntry {
  return { operation, key, duration: 1, startedAt: Date.now() };
}

describe('CacheCollector', () => {
  let collector: CacheCollector;

  beforeEach(() => {
    collector = new CacheCollector();
  });

  it('collects operations and removes the internal key', () => {
    const op = makeOp('GET_HIT');
    const profile = makeProfile({ collectors: { [CACHE_OPERATIONS_KEY]: [op] } });
    expect(collector.collect(profile)).toEqual([op]);
    expect(profile.collectors[CACHE_OPERATIONS_KEY]).toBeUndefined();
  });

  it('returns empty when no operations', () => {
    expect(collector.collect(makeProfile())).toEqual([]);
  });

  it('getBadgeValue returns null when no ops', () => {
    expect(collector.getBadgeValue(makeProfile())).toBeNull();
  });

  it('getBadgeValue shows hit/miss ratio', () => {
    const profile = makeProfile({
      collectors: {
        [CACHE_OPERATIONS_KEY]: [makeOp('GET_HIT'), makeOp('GET_HIT'), makeOp('GET_MISS')],
      },
    });
    expect(collector.getBadgeValue(profile)).toBe('2H/1M');
  });

  it('getBadgeValue shows ops count when no gets', () => {
    const profile = makeProfile({
      collectors: { [CACHE_OPERATIONS_KEY]: [makeOp('SET'), makeOp('DEL')] },
    });
    expect(collector.getBadgeValue(profile)).toBe('2ops');
  });

  it('getBadgeValue reads from profile.collectors[name] after collect() has run', () => {
    const hit = makeOp('GET_HIT');
    const miss = makeOp('GET_MISS');
    const profile = makeProfile({ collectors: { [CACHE_OPERATIONS_KEY]: [hit, miss] } });
    const collected = collector.collect(profile);
    profile.collectors[collector.name] = collected;
    expect(profile.collectors[CACHE_OPERATIONS_KEY]).toBeUndefined();
    expect(collector.getBadgeValue(profile)).toBe('1H/1M');
  });

  it('getTemplatePath returns an absolute path ending with cache-panel.ejs', () => {
    const p = collector.getTemplatePath();
    expect(p).toMatch(/cache-panel\.ejs$/);
    expect(path.isAbsolute(p)).toBe(true);
  });
});

describe('CacheCollectorModule.forRoot', () => {
  it('returns a no-op module when enabled is false', () => {
    expect(CacheCollectorModule.forRoot({ enabled: false })).toEqual({
      module: CacheCollectorModule,
    });
  });

  it('registers providers by default', () => {
    expect(CacheCollectorModule.forRoot().providers?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('CacheManagerPatch', () => {
  interface FakeCacheManager {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  }

  function setup(params: { profile?: Profile | null; clsThrows?: boolean } = {}): {
    cacheManager: FakeCacheManager;
    original: FakeCacheManager;
    profile: Profile | null;
  } {
    const store = new Map<string, unknown>();
    const original: FakeCacheManager = {
      get: jest.fn((k: string) => Promise.resolve(store.get(k))),
      set: jest.fn((k: string, v: unknown) => {
        store.set(k, v);
        return Promise.resolve();
      }),
      del: jest.fn((k: string) => {
        store.delete(k);
        return Promise.resolve();
      }),
    };
    // The patch replaces the methods in place; keep `cacheManager` as the object
    // whose methods get swapped, and `original` as the closure-captured jest mocks.
    const cacheManager: FakeCacheManager = {
      get: original.get,
      set: original.set,
      del: original.del,
    };

    const profile = params.profile === undefined ? makeProfile() : params.profile;
    const cls = {
      get: jest.fn(() => {
        if (params.clsThrows) throw new Error('outside CLS');
        return profile ?? undefined;
      }),
    } as unknown as ClsService;

    const patch = new CacheManagerPatch(cls, cacheManager);
    patch.onModuleInit();
    return { cacheManager, original, profile };
  }

  function opsOf(profile: Profile | null): CacheOperationEntry[] {
    return (profile?.collectors[CACHE_OPERATIONS_KEY] as CacheOperationEntry[] | undefined) ?? [];
  }

  it('does nothing when no cache manager is available', () => {
    const cls = { get: jest.fn() } as unknown as ClsService;
    const patch = new CacheManagerPatch(cls, undefined as never);
    expect(() => patch.onModuleInit()).not.toThrow();
  });

  it('records a GET_HIT and returns the original value', async () => {
    const { cacheManager, original, profile } = setup();
    await cacheManager.set('k', 'v');
    const result: unknown = await cacheManager.get('k');
    expect(result).toBe('v');
    expect(original.get).toHaveBeenCalledWith('k');
    const ops = opsOf(profile);
    expect(ops.some((o) => o.operation === 'SET' && o.key === 'k')).toBe(true);
    expect(ops.some((o) => o.operation === 'GET_HIT' && o.key === 'k')).toBe(true);
  });

  it('records a GET_MISS when the value is absent', async () => {
    const { cacheManager, profile } = setup();
    expect(await cacheManager.get('missing')).toBeUndefined();
    expect(opsOf(profile).some((o) => o.operation === 'GET_MISS')).toBe(true);
  });

  it('records a DEL operation', async () => {
    const { cacheManager, profile } = setup();
    await cacheManager.del('k');
    const op = opsOf(profile).find((o) => o.operation === 'DEL');
    expect(op).toMatchObject({ operation: 'DEL', key: 'k' });
    expect(op?.duration).toBeGreaterThanOrEqual(0);
  });

  it('records nothing but still returns the value when outside a CLS context', async () => {
    const { cacheManager, profile } = setup({ clsThrows: true });
    await cacheManager.set('k', 'v');
    expect(await cacheManager.get('k')).toBe('v');
    expect(opsOf(profile)).toHaveLength(0);
  });

  it('records nothing when there is no active profile', async () => {
    const { cacheManager, profile } = setup({ profile: null });
    await cacheManager.get('k');
    expect(profile).toBeNull();
  });

  it('does not double-instrument when onModuleInit runs twice', async () => {
    const store = new Map<string, unknown>();
    const cacheManager: FakeCacheManager = {
      get: jest.fn((k: string) => Promise.resolve(store.get(k))),
      set: jest.fn(() => Promise.resolve()),
      del: jest.fn(() => Promise.resolve()),
    };
    const profile = makeProfile();
    const cls = { get: jest.fn(() => profile) } as unknown as ClsService;

    const patch = new CacheManagerPatch(cls, cacheManager);
    patch.onModuleInit();
    patch.onModuleInit();

    await cacheManager.get('k');
    // A single GET, instrumented once — not twice.
    expect(opsOf(profile)).toHaveLength(1);
  });
});
