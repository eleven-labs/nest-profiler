import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SqliteStorageAdapter } from './sqlite-storage.adapter';
import type { Profile } from '../../interfaces/profile.interface';

// The shared save/findOne/findAll/TTL/LRU/clear behaviour is covered for every adapter
// in `storage-adapter.contract.spec.ts`. This spec keeps only what is specific to the
// SQLite adapter: native pushed-down query/distinct, index attributes, the eviction
// counter, file persistence and corruption handling.

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

  afterEach(() => {
    adapter.close();
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

    it('filters by an indexed performance tag (whole-id contains)', () => {
      adapter.save(makeProfile('slow-one', { tags: ['slow', 'n-plus-one'] }));
      adapter.save(makeProfile('very-slow', { tags: ['very-slow'] }));
      adapter.save(makeProfile('clean'));

      const slow = adapter.query({
        filters: [{ field: 'tags', op: 'contains', value: ' slow ' }],
        page: 1,
        pageSize: 10,
      });
      // ' very-slow ' must not match a ' slow ' filter.
      expect(slow.items.map((p) => p.token)).toEqual(['slow-one']);
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

  describe('eviction counter', () => {
    it('re-saving the same token never evicts the live row', () => {
      const small = new SqliteStorageAdapter({ path: ':memory:', maxProfiles: 3, ttl: 3600 });
      for (let i = 0; i < 20; i++) small.save(makeProfile('x', { duration: i }));
      expect(small.findAll().map((p) => p.token)).toEqual(['x']);
      expect(small.findOne('x')?.performance.duration).toBe(19);
      small.close();
    });

    it('seeds the row count from an existing file so eviction stays capped after reopen', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-count-'));
      const file = path.join(dir, 'p.db');
      const base = Date.now();

      const a = new SqliteStorageAdapter({ path: file, maxProfiles: 3, ttl: 3600 });
      for (let i = 0; i < 3; i++) a.save(makeProfile(`a-${i}`, { createdAt: base + i }));
      a.close();

      const b = new SqliteStorageAdapter({ path: file, maxProfiles: 3, ttl: 3600 });
      b.save(makeProfile('a-3', { createdAt: base + 3 }));
      expect(b.findAll().map((p) => p.token)).toEqual(['a-3', 'a-2', 'a-1']);
      b.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('open error handling', () => {
    const writeGarbageDb = (): { dir: string; file: string } => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-corrupt-'));
      const file = path.join(dir, 'p.db');
      fs.writeFileSync(file, 'this is definitely not a sqlite database');
      return { dir, file };
    };

    it("throws an actionable, cause-chained error when onCorruption is 'throw'", () => {
      const { dir, file } = writeGarbageDb();
      let caught: Error | undefined;
      try {
        new SqliteStorageAdapter({ path: file, onCorruption: 'throw' });
      } catch (err) {
        caught = err as Error;
      }
      expect(caught?.message).toContain(file);
      expect(caught?.cause).toBeDefined();
      // The corrupt file is left untouched for inspection.
      expect(fs.readdirSync(dir)).toEqual(['p.db']);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('recreates a fresh database and moves the corrupt file aside by default', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { dir, file } = writeGarbageDb();

      const adapter = new SqliteStorageAdapter({ path: file }); // default onCorruption: 'recreate'
      adapter.save(makeProfile('fresh'));
      expect(adapter.findOne('fresh')?.token).toBe('fresh');
      adapter.close();

      const asideFiles = fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'));
      expect(asideFiles).toHaveLength(1);
      expect(warn).toHaveBeenCalled();

      warn.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  it('accepts a custom busyTimeout', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-busy-'));
    const file = path.join(dir, 'p.db');
    const timed = new SqliteStorageAdapter({ path: file, busyTimeout: 1234 });
    timed.save(makeProfile('a'));
    expect(timed.findOne('a')?.token).toBe('a');
    timed.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
