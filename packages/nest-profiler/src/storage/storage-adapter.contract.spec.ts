import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileStorageAdapter } from './file-storage.adapter';
import { MemoryStorageAdapter } from './memory-storage.adapter';
import { SqliteStorageAdapter } from './sqlite/sqlite-storage.adapter';
import type { IProfilerStorageAdapter } from './storage-adapter.interface';
import type { HttpRequestData, Profile } from '../interfaces/profile.interface';

/**
 * Cross-adapter contract suite: the behaviour every {@link IProfilerStorageAdapter}
 * must share (save/findOne/findAll, TTL expiry, LRU eviction, clear, crossProcess)
 * is asserted once against each implementation via `describe.each`, instead of being
 * re-implemented — and left to drift — in each adapter's own spec. Adapter-specific
 * concerns (the file sidecar index & concurrency, SQLite corruption handling…) stay
 * in the per-adapter specs.
 */

function makeProfile(
  token: string,
  o: { createdAt?: number; method?: string; route?: string } = {},
): Profile {
  const createdAt = o.createdAt ?? Date.now();
  const method = o.method ?? 'GET';
  return {
    token,
    createdAt,
    entrypoint: {
      type: 'http',
      data: { method, url: `/${token}`, headers: {}, query: {} },
    },
    performance: { startTime: createdAt, heapUsed: 0, duration: 10 },
    logs: [],
    exceptions: [],
    collectors: {},
    ...(o.route ? { route: { controller: 'C', handler: 'h', path: o.route, method } } : {}),
  };
}

interface AdapterFactoryOptions {
  maxProfiles?: number;
  ttl?: number;
}

interface AdapterCase {
  name: string;
  /** Expected value of the adapter's `crossProcess` flag in this configuration. */
  crossProcess: boolean;
  /** Whether the adapter implements a native `query`/`distinct` (vs the service fallback). */
  hasNativeQuery: boolean;
  create: (
    opts?: AdapterFactoryOptions,
  ) => Promise<{ adapter: IProfilerStorageAdapter; cleanup: () => Promise<void> }>;
}

const cases: AdapterCase[] = [
  {
    name: 'MemoryStorageAdapter',
    crossProcess: false,
    hasNativeQuery: false,
    create: (opts) =>
      Promise.resolve({
        adapter: new MemoryStorageAdapter(opts),
        cleanup: () => Promise.resolve(),
      }),
  },
  {
    name: 'FileStorageAdapter',
    crossProcess: true,
    hasNativeQuery: true,
    create: async (opts) => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'profiler-contract-'));
      return {
        adapter: new FileStorageAdapter({ storagePath: dir, ...opts }),
        cleanup: () => fs.promises.rm(dir, { recursive: true, force: true }),
      };
    },
  },
  {
    name: 'SqliteStorageAdapter (:memory:)',
    crossProcess: false,
    hasNativeQuery: true,
    create: (opts) => {
      const adapter = new SqliteStorageAdapter({ path: ':memory:', ...opts });
      return Promise.resolve({ adapter, cleanup: () => Promise.resolve(adapter.close?.()) });
    },
  },
];

describe.each(cases)(
  'IProfilerStorageAdapter contract: $name',
  ({ create, crossProcess, hasNativeQuery }) => {
    const cleanups: Array<() => Promise<void>> = [];

    async function make(opts?: AdapterFactoryOptions): Promise<IProfilerStorageAdapter> {
      const { adapter, cleanup } = await create(opts);
      cleanups.push(cleanup);
      return adapter;
    }

    afterEach(async () => {
      while (cleanups.length > 0) {
        await cleanups.pop()?.();
      }
    });

    it('exposes the expected crossProcess flag', async () => {
      const adapter = await make();
      expect(adapter.crossProcess).toBe(crossProcess);
    });

    describe('save / findOne', () => {
      it('stores and retrieves a profile by token', async () => {
        const adapter = await make();
        await adapter.save(makeProfile('a'));
        expect((await adapter.findOne('a'))?.token).toBe('a');
      });

      it('returns undefined for an unknown token', async () => {
        const adapter = await make();
        expect(await adapter.findOne('missing')).toBeUndefined();
      });
    });

    describe('findAll', () => {
      it('returns profiles newest-first', async () => {
        const adapter = await make();
        const base = Date.now();
        await adapter.save(makeProfile('a', { createdAt: base }));
        await adapter.save(makeProfile('b', { createdAt: base + 100 }));
        await adapter.save(makeProfile('c', { createdAt: base + 200 }));
        expect((await adapter.findAll()).map((p) => p.token)).toEqual(['c', 'b', 'a']);
      });

      it('applies the legacy method filter', async () => {
        const adapter = await make();
        await adapter.save(makeProfile('get', { method: 'GET' }));
        await adapter.save(makeProfile('post', { method: 'POST' }));
        const results = await adapter.findAll({ method: 'POST' });
        expect(results.map((p) => p.token)).toEqual(['post']);
        expect(results.every((p) => (p.entrypoint.data as HttpRequestData).method === 'POST')).toBe(
          true,
        );
      });
    });

    describe('TTL expiration', () => {
      it('drops an expired profile from findOne and findAll', async () => {
        const adapter = await make({ ttl: 1 });
        await adapter.save(makeProfile('stale', { createdAt: Date.now() - 5000 }));
        await adapter.save(makeProfile('fresh'));
        expect(await adapter.findOne('stale')).toBeUndefined();
        expect((await adapter.findAll()).map((p) => p.token)).toEqual(['fresh']);
      });

      it('never expires when ttl is 0', async () => {
        const adapter = await make({ ttl: 0 });
        await adapter.save(
          makeProfile('ancient', { createdAt: Date.now() - 10 * 365 * 24 * 3600 * 1000 }),
        );
        expect((await adapter.findOne('ancient'))?.token).toBe('ancient');
        expect((await adapter.findAll()).map((p) => p.token)).toEqual(['ancient']);
      });
    });

    describe('LRU eviction', () => {
      it('evicts the oldest profile when maxProfiles is exceeded', async () => {
        const adapter = await make({ maxProfiles: 2, ttl: 3600 });
        const base = Date.now();
        await adapter.save(makeProfile('a', { createdAt: base }));
        await adapter.save(makeProfile('b', { createdAt: base + 1 }));
        await adapter.save(makeProfile('c', { createdAt: base + 2 }));
        expect(await adapter.findOne('a')).toBeUndefined();
        expect(await adapter.findOne('b')).toBeDefined();
        expect(await adapter.findOne('c')).toBeDefined();
      });

      it('never caps the store when maxProfiles is 0', async () => {
        const adapter = await make({ maxProfiles: 0, ttl: 3600 });
        const base = Date.now();
        for (let i = 0; i < 150; i++)
          await adapter.save(makeProfile(`u-${i}`, { createdAt: base + i }));
        expect(await adapter.findAll()).toHaveLength(150);
      });
    });

    describe('clear', () => {
      it('removes every stored profile', async () => {
        const adapter = await make();
        await adapter.save(makeProfile('a'));
        await adapter.save(makeProfile('b'));
        await adapter.clear();
        expect(await adapter.findAll()).toEqual([]);
        expect(await adapter.findOne('a')).toBeUndefined();
      });
    });

    (hasNativeQuery ? describe : describe.skip)('native query() / distinct()', () => {
      it('filters, sorts newest-first and paginates with a total', async () => {
        const adapter = await make({ maxProfiles: 100, ttl: 3600 });
        const base = Date.now();
        await adapter.save(makeProfile('get1', { method: 'GET', createdAt: base }));
        await adapter.save(makeProfile('post1', { method: 'POST', createdAt: base + 1 }));
        await adapter.save(makeProfile('get2', { method: 'GET', createdAt: base + 2 }));

        const page1 = await adapter.query!({ filters: [], page: 1, pageSize: 2 });
        expect(page1.total).toBe(3);
        expect(page1.items.map((p) => p.token)).toEqual(['get2', 'post1']);

        const filtered = await adapter.query!({
          filters: [{ field: 'method', op: 'eq', value: 'POST' }],
          page: 1,
          pageSize: 10,
        });
        expect(filtered.items.map((p) => p.token)).toEqual(['post1']);
      });

      it('returns the distinct values of a field', async () => {
        const adapter = await make({ maxProfiles: 100, ttl: 3600 });
        const base = Date.now();
        await adapter.save(makeProfile('a', { method: 'GET', createdAt: base }));
        await adapter.save(makeProfile('b', { method: 'POST', createdAt: base + 1 }));
        await adapter.save(makeProfile('c', { method: 'POST', createdAt: base + 2 }));
        expect((await adapter.distinct!('method')).sort()).toEqual(['GET', 'POST']);
      });

      it('querySummaries returns lightweight summaries (with route), newest-first and paginated', async () => {
        const adapter = await make({ maxProfiles: 100, ttl: 3600 });
        const base = Date.now();
        await adapter.save(
          makeProfile('get1', { method: 'GET', createdAt: base, route: '/a/:id' }),
        );
        await adapter.save(makeProfile('post1', { method: 'POST', createdAt: base + 1 }));
        await adapter.save(
          makeProfile('get2', { method: 'GET', createdAt: base + 2, route: '/a/:id' }),
        );

        const summaries = await adapter.querySummaries!({ filters: [], page: 1, pageSize: 2 });
        // Newest-first, page-bounded, and summaries (not full profiles): no `collectors`/`logs` keys.
        expect(summaries.map((s) => s.token)).toEqual(['get2', 'post1']);
        expect(summaries[0]).not.toHaveProperty('collectors');
        // The matched route pattern is projected onto the summary; absent → undefined.
        expect(summaries.find((s) => s.token === 'get2')?.route).toBe('/a/:id');
        expect(summaries.find((s) => s.token === 'post1')?.route).toBeUndefined();

        const filtered = await adapter.querySummaries!({
          filters: [{ field: 'method', op: 'eq', value: 'POST' }],
          page: 1,
          pageSize: 10,
        });
        expect(filtered.map((s) => s.token)).toEqual(['post1']);
      });
    });
  },
);
