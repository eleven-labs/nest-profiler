import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SqliteStorageAdapter } from './sqlite-storage.adapter';
import type { Profile } from '../../interfaces/profile.interface';

// The shared save/findOne/findAll/TTL/LRU/clear behaviour is covered for every adapter
// in `storage-adapter.contract.spec.ts`. This spec keeps only what is specific to the
// SQLite (libSQL) adapter: native pushed-down query/distinct, index attributes, the
// eviction counter, file persistence and the local/remote target resolution.

function makeProfile(
  token: string,
  o: {
    type?: string;
    method?: string;
    url?: string;
    statusCode?: number;
    duration?: number;
    exceptions?: number;
    createdAt?: number;
    tags?: string[];
  } = {},
): Profile {
  return {
    token,
    createdAt: o.createdAt ?? Date.now(),
    entrypoint: {
      type: o.type ?? 'http',
      data: { method: o.method ?? 'GET', url: o.url ?? `/${token}`, headers: {}, query: {} },
    },
    response: o.statusCode !== undefined ? { statusCode: o.statusCode, headers: {} } : undefined,
    performance: { startTime: 0, heapUsed: 0, duration: o.duration },
    logs: [],
    exceptions: Array.from({ length: o.exceptions ?? 0 }, () => ({
      name: 'E',
      message: 'm',
      timestamp: 0,
    })),
    collectors: {},
    tags: o.tags?.map((id) => ({ id, label: id, severity: 'warning' as const })),
  };
}

describe('SqliteStorageAdapter', () => {
  let adapter: SqliteStorageAdapter;

  beforeEach(() => {
    adapter = new SqliteStorageAdapter({ path: ':memory:', maxProfiles: 100, ttl: 3600 });
  });

  afterEach(async () => {
    await adapter.close();
  });

  it('crossProcess is true for a file database and false for :memory:', async () => {
    expect(adapter.crossProcess).toBe(false);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-cp-'));
    const fileAdapter = new SqliteStorageAdapter({ path: path.join(dir, 'p.db') });
    expect(fileAdapter.crossProcess).toBe(true);
    await fileAdapter.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('treats a remote url as cross-process and stores through it', async () => {
    // libSQL accepts `:memory:` through the same client path as a remote url; use it to exercise
    // the url branch without a network dependency.
    const remote = new SqliteStorageAdapter({ url: ':memory:' });
    expect(remote.crossProcess).toBe(true);
    await remote.save(makeProfile('via-url'));
    expect((await remote.findOne('via-url'))?.token).toBe('via-url');
    await remote.close();
  });

  it('persists profiles to a file across adapter instances', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-persist-'));
    const file = path.join(dir, 'nested', 'profiler.db'); // parent dir auto-created
    const a = new SqliteStorageAdapter({ path: file });
    await a.save(makeProfile('kept'));
    await a.close();

    const b = new SqliteStorageAdapter({ path: file });
    expect((await b.findOne('kept'))?.token).toBe('kept');
    await b.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('query()', () => {
    const seed = async (): Promise<void> => {
      const base = Date.now();
      await adapter.save(
        makeProfile('a', { method: 'GET', statusCode: 200, duration: 5, createdAt: base }),
      );
      await adapter.save(
        makeProfile('b', { method: 'POST', statusCode: 500, duration: 250, createdAt: base + 1 }),
      );
      await adapter.save(
        makeProfile('c', { type: 'graphql', statusCode: 200, duration: 40, createdAt: base + 2 }),
      );
      await adapter.save(
        makeProfile('d', {
          method: 'GET',
          statusCode: 404,
          duration: 5,
          exceptions: 1,
          createdAt: base + 3,
        }),
      );
    };

    it('sorts newest-first, paginates and reports the total', async () => {
      await seed();
      const page1 = await adapter.query({ filters: [], page: 1, pageSize: 2 });
      expect(page1.total).toBe(4);
      expect(page1.items.map((p) => p.token)).toEqual(['d', 'c']);
      const page2 = await adapter.query({ filters: [], page: 2, pageSize: 2 });
      expect(page2.items.map((p) => p.token)).toEqual(['b', 'a']);
    });

    it('supports ascending sort', async () => {
      await seed();
      const page = await adapter.query({
        filters: [],
        sort: { field: 'createdAt', direction: 'asc' },
        page: 1,
        pageSize: 2,
      });
      expect(page.items.map((p) => p.token)).toEqual(['a', 'b']);
    });

    it('filters by typeIn and typeNotIn', async () => {
      await seed();
      expect(
        (
          await adapter.query({ typeIn: ['graphql'], filters: [], page: 1, pageSize: 10 })
        ).items.map((p) => p.token),
      ).toEqual(['c']);
      expect(
        (
          await adapter.query({ typeNotIn: ['graphql'], filters: [], page: 1, pageSize: 10 })
        ).items.map((p) => p.token),
      ).toEqual(['d', 'b', 'a']);
    });

    it('applies eq (case-insensitive), range, gte/lte, contains and truthy criteria', async () => {
      await seed();
      const byMethod = await adapter.query({
        filters: [{ field: 'method', op: 'eq', value: 'get' }],
        page: 1,
        pageSize: 10,
      });
      // a, c and d default to GET (c is graphql but still carries an HTTP method).
      expect(byMethod.items.map((p) => p.token).sort()).toEqual(['a', 'c', 'd']);

      const byClass = await adapter.query({
        filters: [{ field: 'statusCode', op: 'range', value: [200, 299] }],
        page: 1,
        pageSize: 10,
      });
      expect(byClass.items.map((p) => p.token).sort()).toEqual(['a', 'c']);

      const slow = await adapter.query({
        filters: [{ field: 'duration', op: 'gte', value: 100 }],
        page: 1,
        pageSize: 10,
      });
      expect(slow.items.map((p) => p.token)).toEqual(['b']);

      const fast = await adapter.query({
        filters: [{ field: 'duration', op: 'lte', value: 10 }],
        page: 1,
        pageSize: 10,
      });
      expect(fast.items.map((p) => p.token).sort()).toEqual(['a', 'd']);

      const search = await adapter.query({
        filters: [{ field: 'search', op: 'contains', value: '/B' }],
        page: 1,
        pageSize: 10,
      });
      expect(search.items.map((p) => p.token)).toEqual(['b']);

      const withExc = await adapter.query({
        filters: [{ field: 'hasExceptions', op: 'truthy' }],
        page: 1,
        pageSize: 10,
      });
      expect(withExc.items.map((p) => p.token)).toEqual(['d']);
    });

    it('filters by an indexed performance tag (whole-id contains)', async () => {
      await adapter.save(makeProfile('slow-one', { tags: ['slow', 'n-plus-one'] }));
      await adapter.save(makeProfile('very-slow', { tags: ['very-slow'] }));
      await adapter.save(makeProfile('clean'));

      const slow = await adapter.query({
        filters: [{ field: 'tags', op: 'contains', value: ' slow ' }],
        page: 1,
        pageSize: 10,
      });
      // ' very-slow ' must not match a ' slow ' filter.
      expect(slow.items.map((p) => p.token)).toEqual(['slow-one']);
    });
  });

  describe('distinct()', () => {
    it('returns distinct non-empty values of a base field, optionally by type', async () => {
      await adapter.save(makeProfile('a', { method: 'GET' }));
      await adapter.save(makeProfile('b', { method: 'POST' }));
      await adapter.save(makeProfile('c', { method: 'POST', type: 'graphql' }));
      expect(((await adapter.distinct('method')) as string[]).sort()).toEqual(['GET', 'POST']);
      expect(await adapter.distinct('method', ['graphql'])).toEqual(['POST']);
    });
  });

  describe('index attributes', () => {
    beforeEach(() => {
      adapter.setIndexAttributesProvider((p) => ({
        operationType: (p.entrypoint.data as { op?: string }).op ?? '',
      }));
    });

    it('indexes and queries kind-specific attributes and lists them via distinct', async () => {
      const base = Date.now();
      const mutation = makeProfile('m', { type: 'graphql', createdAt: base });
      (mutation.entrypoint.data as { op?: string }).op = 'mutation';
      const queryOp = makeProfile('q', { type: 'graphql', createdAt: base + 1 });
      (queryOp.entrypoint.data as { op?: string }).op = 'query';
      await adapter.save(mutation);
      await adapter.save(queryOp);

      const page = await adapter.query({
        filters: [{ field: 'attributes.operationType', op: 'eq', value: 'mutation' }],
        page: 1,
        pageSize: 10,
      });
      expect(page.items.map((p) => p.token)).toEqual(['m']);
      expect(((await adapter.distinct('attributes.operationType')) as string[]).sort()).toEqual([
        'mutation',
        'query',
      ]);
    });

    it('matches a boolean attribute (as rabbitmq/commander index it)', async () => {
      const boolAdapter = new SqliteStorageAdapter({ path: ':memory:' });
      boolAdapter.setIndexAttributesProvider((p) => ({
        redelivered: (p.entrypoint.data as { redelivered?: boolean }).redelivered === true,
      }));
      const base = Date.now();
      const first = makeProfile('first', { type: 'rabbitmq', createdAt: base });
      const again = makeProfile('again', { type: 'rabbitmq', createdAt: base + 1 });
      (again.entrypoint.data as { redelivered?: boolean }).redelivered = true;
      await boolAdapter.save(first);
      await boolAdapter.save(again);

      const redelivered = await boolAdapter.query({
        filters: [{ field: 'attributes.redelivered', op: 'eq', value: true }],
        page: 1,
        pageSize: 10,
      });
      expect(redelivered.items.map((p) => p.token)).toEqual(['again']);
      await boolAdapter.close();
    });
  });

  it('a criterion on an unknown field matches nothing', async () => {
    await adapter.save(makeProfile('a'));
    const page = await adapter.query({
      filters: [{ field: 'nope', op: 'eq', value: 'x' }],
      page: 1,
      pageSize: 10,
    });
    expect(page.total).toBe(0);
    expect(page.items).toEqual([]);
  });

  describe('eviction counter', () => {
    it('re-saving the same token never evicts the live row', async () => {
      const small = new SqliteStorageAdapter({ path: ':memory:', maxProfiles: 3, ttl: 3600 });
      for (let i = 0; i < 20; i++) await small.save(makeProfile('x', { duration: i }));
      expect((await small.findAll()).map((p) => p.token)).toEqual(['x']);
      expect((await small.findOne('x'))?.performance.duration).toBe(19);
      await small.close();
    });

    it('seeds the row count from an existing file so eviction stays capped after reopen', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-count-'));
      const file = path.join(dir, 'p.db');
      const base = Date.now();

      const a = new SqliteStorageAdapter({ path: file, maxProfiles: 3, ttl: 3600 });
      for (let i = 0; i < 3; i++) await a.save(makeProfile(`a-${i}`, { createdAt: base + i }));
      await a.close();

      const b = new SqliteStorageAdapter({ path: file, maxProfiles: 3, ttl: 3600 });
      await b.save(makeProfile('a-3', { createdAt: base + 3 }));
      expect((await b.findAll()).map((p) => p.token)).toEqual(['a-3', 'a-2', 'a-1']);
      await b.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });
});
