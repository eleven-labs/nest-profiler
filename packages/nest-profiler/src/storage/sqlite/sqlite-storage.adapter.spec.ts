import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SqliteStorageAdapter } from './sqlite-storage.adapter';
import type { Profile } from '../../interfaces/profile.interface';

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
  };
}

describe('SqliteStorageAdapter', () => {
  let adapter: SqliteStorageAdapter;

  beforeEach(() => {
    adapter = new SqliteStorageAdapter({ path: ':memory:', maxProfiles: 100, ttl: 3600 });
  });

  afterEach(() => {
    adapter.close();
  });

  it('saves and retrieves a profile', () => {
    const p = makeProfile('abc');
    adapter.save(p);
    expect(adapter.findOne('abc')?.token).toBe('abc');
  });

  it('findOne returns undefined for an unknown token', () => {
    expect(adapter.findOne('nope')).toBeUndefined();
  });

  it('findAll returns profiles newest-first', () => {
    const base = Date.now();
    adapter.save(makeProfile('a', { createdAt: base }));
    adapter.save(makeProfile('b', { createdAt: base + 1 }));
    adapter.save(makeProfile('c', { createdAt: base + 2 }));
    expect(adapter.findAll().map((p) => p.token)).toEqual(['c', 'b', 'a']);
  });

  it('findAll applies legacy StorageFindOptions', () => {
    adapter.save(makeProfile('get', { method: 'GET' }));
    adapter.save(makeProfile('post', { method: 'POST' }));
    const results = adapter.findAll({ method: 'POST' });
    expect(results.map((p) => p.token)).toEqual(['post']);
  });

  it('clear removes everything', () => {
    adapter.save(makeProfile('x'));
    adapter.clear();
    expect(adapter.findAll()).toEqual([]);
  });

  it('excludes profiles past their TTL', () => {
    const ttlAdapter = new SqliteStorageAdapter({ path: ':memory:', ttl: 1 });
    ttlAdapter.save(makeProfile('stale', { createdAt: Date.now() - 5000 }));
    expect(ttlAdapter.findOne('stale')).toBeUndefined();
    expect(ttlAdapter.findAll()).toEqual([]);
    ttlAdapter.close();
  });

  it('evicts the oldest profiles beyond maxProfiles', () => {
    const small = new SqliteStorageAdapter({ path: ':memory:', maxProfiles: 3, ttl: 3600 });
    const base = Date.now();
    for (let i = 0; i < 5; i++) small.save(makeProfile(`e-${i}`, { createdAt: base + i }));
    expect(small.findAll().map((p) => p.token)).toEqual(['e-4', 'e-3', 'e-2']);
    small.close();
  });

  it('crossProcess is true for a file database and false for :memory:', () => {
    expect(adapter.crossProcess).toBe(false);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-cp-'));
    const fileAdapter = new SqliteStorageAdapter({ path: path.join(dir, 'p.db') });
    expect(fileAdapter.crossProcess).toBe(true);
    fileAdapter.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('persists profiles to a file across adapter instances', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-persist-'));
    const file = path.join(dir, 'nested', 'profiler.db'); // parent dir auto-created
    const a = new SqliteStorageAdapter({ path: file });
    a.save(makeProfile('kept'));
    a.close();

    const b = new SqliteStorageAdapter({ path: file });
    expect(b.findOne('kept')?.token).toBe('kept');
    b.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('query()', () => {
    const seed = (): void => {
      const base = Date.now();
      adapter.save(
        makeProfile('a', { method: 'GET', statusCode: 200, duration: 5, createdAt: base }),
      );
      adapter.save(
        makeProfile('b', { method: 'POST', statusCode: 500, duration: 250, createdAt: base + 1 }),
      );
      adapter.save(
        makeProfile('c', { type: 'graphql', statusCode: 200, duration: 40, createdAt: base + 2 }),
      );
      adapter.save(
        makeProfile('d', {
          method: 'GET',
          statusCode: 404,
          duration: 5,
          exceptions: 1,
          createdAt: base + 3,
        }),
      );
    };

    it('sorts newest-first, paginates and reports the total', () => {
      seed();
      const page1 = adapter.query({ filters: [], page: 1, pageSize: 2 });
      expect(page1.total).toBe(4);
      expect(page1.items.map((p) => p.token)).toEqual(['d', 'c']);
      const page2 = adapter.query({ filters: [], page: 2, pageSize: 2 });
      expect(page2.items.map((p) => p.token)).toEqual(['b', 'a']);
    });

    it('supports ascending sort', () => {
      seed();
      const page = adapter.query({
        filters: [],
        sort: { field: 'createdAt', direction: 'asc' },
        page: 1,
        pageSize: 2,
      });
      expect(page.items.map((p) => p.token)).toEqual(['a', 'b']);
    });

    it('filters by typeIn and typeNotIn', () => {
      seed();
      expect(
        adapter
          .query({ typeIn: ['graphql'], filters: [], page: 1, pageSize: 10 })
          .items.map((p) => p.token),
      ).toEqual(['c']);
      expect(
        adapter
          .query({ typeNotIn: ['graphql'], filters: [], page: 1, pageSize: 10 })
          .items.map((p) => p.token),
      ).toEqual(['d', 'b', 'a']);
    });

    it('applies eq (case-insensitive), range, gte/lte, contains and truthy criteria', () => {
      seed();
      const byMethod = adapter.query({
        filters: [{ field: 'method', op: 'eq', value: 'get' }],
        page: 1,
        pageSize: 10,
      });
      // a, c and d default to GET (c is graphql but still carries an HTTP method).
      expect(byMethod.items.map((p) => p.token).sort()).toEqual(['a', 'c', 'd']);

      const byClass = adapter.query({
        filters: [{ field: 'statusCode', op: 'range', value: [200, 299] }],
        page: 1,
        pageSize: 10,
      });
      expect(byClass.items.map((p) => p.token).sort()).toEqual(['a', 'c']);

      const slow = adapter.query({
        filters: [{ field: 'duration', op: 'gte', value: 100 }],
        page: 1,
        pageSize: 10,
      });
      expect(slow.items.map((p) => p.token)).toEqual(['b']);

      const fast = adapter.query({
        filters: [{ field: 'duration', op: 'lte', value: 10 }],
        page: 1,
        pageSize: 10,
      });
      expect(fast.items.map((p) => p.token).sort()).toEqual(['a', 'd']);

      const search = adapter.query({
        filters: [{ field: 'search', op: 'contains', value: '/B' }],
        page: 1,
        pageSize: 10,
      });
      expect(search.items.map((p) => p.token)).toEqual(['b']);

      const withExc = adapter.query({
        filters: [{ field: 'hasExceptions', op: 'truthy' }],
        page: 1,
        pageSize: 10,
      });
      expect(withExc.items.map((p) => p.token)).toEqual(['d']);
    });
  });

  describe('distinct()', () => {
    it('returns distinct non-empty values of a base field, optionally by type', () => {
      adapter.save(makeProfile('a', { method: 'GET' }));
      adapter.save(makeProfile('b', { method: 'POST' }));
      adapter.save(makeProfile('c', { method: 'POST', type: 'graphql' }));
      expect((adapter.distinct('method') as string[]).sort()).toEqual(['GET', 'POST']);
      expect(adapter.distinct('method', ['graphql'])).toEqual(['POST']);
    });
  });

  describe('index attributes', () => {
    beforeEach(() => {
      adapter.setIndexAttributesProvider((p) => ({
        operationType: (p.entrypoint.data as { op?: string }).op ?? '',
      }));
    });

    it('indexes and queries kind-specific attributes and lists them via distinct', () => {
      const base = Date.now();
      const mutation = makeProfile('m', { type: 'graphql', createdAt: base });
      (mutation.entrypoint.data as { op?: string }).op = 'mutation';
      const queryOp = makeProfile('q', { type: 'graphql', createdAt: base + 1 });
      (queryOp.entrypoint.data as { op?: string }).op = 'query';
      adapter.save(mutation);
      adapter.save(queryOp);

      const page = adapter.query({
        filters: [{ field: 'attributes.operationType', op: 'eq', value: 'mutation' }],
        page: 1,
        pageSize: 10,
      });
      expect(page.items.map((p) => p.token)).toEqual(['m']);
      expect((adapter.distinct('attributes.operationType') as string[]).sort()).toEqual([
        'mutation',
        'query',
      ]);
    });

    it('matches a boolean attribute (as rabbitmq/commander index it)', () => {
      const boolAdapter = new SqliteStorageAdapter({ path: ':memory:' });
      boolAdapter.setIndexAttributesProvider((p) => ({
        redelivered: (p.entrypoint.data as { redelivered?: boolean }).redelivered === true,
      }));
      const base = Date.now();
      const first = makeProfile('first', { type: 'rabbitmq', createdAt: base });
      const again = makeProfile('again', { type: 'rabbitmq', createdAt: base + 1 });
      (again.entrypoint.data as { redelivered?: boolean }).redelivered = true;
      boolAdapter.save(first);
      boolAdapter.save(again);

      const redelivered = boolAdapter.query({
        filters: [{ field: 'attributes.redelivered', op: 'eq', value: true }],
        page: 1,
        pageSize: 10,
      });
      expect(redelivered.items.map((p) => p.token)).toEqual(['again']);
      boolAdapter.close();
    });
  });

  it('a criterion on an unknown field matches nothing', () => {
    adapter.save(makeProfile('a'));
    const page = adapter.query({
      filters: [{ field: 'nope', op: 'eq', value: 'x' }],
      page: 1,
      pageSize: 10,
    });
    expect(page.total).toBe(0);
    expect(page.items).toEqual([]);
  });
});
