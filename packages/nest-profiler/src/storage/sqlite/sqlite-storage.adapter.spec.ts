import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';
import { createClient, type Client, type InStatement } from '@libsql/client';
import { SqliteStorageAdapter } from './sqlite-storage.adapter';
import type { Profile } from '../../interfaces/profile.interface';

/** Every SQL statement sent through a client, so a test can assert what an open does and does not run. */
const executedSql: string[] = [];

jest.mock('@libsql/client', () => {
  const actual = jest.requireActual<typeof import('@libsql/client')>('@libsql/client');
  return {
    ...actual,
    createClient: (config: Parameters<typeof actual.createClient>[0]): Client => {
      const client = actual.createClient(config);
      return new Proxy(client, {
        get(target, property, receiver) {
          if (property === 'execute') {
            return (statement: InStatement) => {
              executedSql.push(typeof statement === 'string' ? statement : statement.sql);
              return target.execute(statement);
            };
          }
          if (property === 'executeMultiple') {
            return (sql: string) => {
              executedSql.push(sql);
              return target.executeMultiple(sql);
            };
          }
          const value: unknown = Reflect.get(target, property, receiver);
          return typeof value === 'function'
            ? (value as (...args: unknown[]) => unknown).bind(target)
            : value;
        },
      });
    },
  };
});

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
    traceId: `trace-${token}`,
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

  // Durations are fractional milliseconds, and the summary column is declared `INTEGER`.
  // SQLite's numeric affinity keeps a real that cannot be losslessly narrowed, so the value
  // survives on existing databases as well as new ones — asserted rather than assumed, since a
  // truncation here would silently undo the whole point of measuring sub-millisecond work.
  it('round-trips a fractional duration through the summary column and its ordering', async () => {
    await adapter.save(makeProfile('sub-ms', { duration: 0.42 }));
    await adapter.save(makeProfile('few-ms', { duration: 1.618 }));

    expect((await adapter.findOne('sub-ms'))?.performance.duration).toBe(0.42);

    const { items } = await adapter.query({
      filters: [{ field: 'duration', op: 'gte', value: 1 }],
      page: 1,
      pageSize: 10,
    });
    expect(items.map((p) => p.token)).toEqual(['few-ms']);
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

    it('matches eq on a numeric field and escapes LIKE wildcards in contains', async () => {
      await seed();
      const byStatus = await adapter.query({
        filters: [{ field: 'statusCode', op: 'eq', value: 200 }],
        page: 1,
        pageSize: 10,
      });
      expect(byStatus.items.map((p) => p.token).sort()).toEqual(['a', 'c']);

      // A `%` in the value is escaped, so it matches literally (nothing here) rather than as a wildcard.
      const wildcard = await adapter.query({
        filters: [{ field: 'search', op: 'contains', value: 'a%' }],
        page: 1,
        pageSize: 10,
      });
      expect(wildcard.items).toEqual([]);
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

  describe('schema version', () => {
    it('reuses a database written by the current schema version', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-schema-'));
      const file = path.join(dir, 'p.db');

      const a = new SqliteStorageAdapter({ path: file });
      await a.save(makeProfile('keep'));
      await a.close();

      const b = new SqliteStorageAdapter({ path: file });
      expect((await b.findAll()).map((p) => p.token)).toEqual(['keep']);
      await b.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    // Hosted libSQL servers (Turso) reject `PRAGMA <name> = <value>` over the remote protocol with
    // SQL_PARSE_ERROR, so an init that writes a pragma fails every open against a remote database —
    // something no local test can reproduce, since a file database accepts pragmas happily.
    it('records the schema version without writing a pragma on a remote database', async () => {
      executedSql.length = 0;
      const remote = new SqliteStorageAdapter({ url: ':memory:' });
      await remote.save(makeProfile('remote'));

      expect(executedSql.some((sql) => /PRAGMA\s+\w+\s*=/i.test(sql))).toBe(false);
      expect((await remote.findOne('remote'))?.token).toBe('remote');
      await remote.close();
    });

    // `CREATE TABLE IF NOT EXISTS` never alters an existing table, so a database left behind by
    // another schema version has to be recreated — otherwise a column added in a later release is
    // simply missing and every query against it fails.
    it('recreates a database written by a different schema version', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-stale-'));
      const file = path.join(dir, 'p.db');

      const a = new SqliteStorageAdapter({ path: file });
      await a.save(makeProfile('stale'));
      await a.close();

      // Simulate a store written by an older layout: a table missing a column the code now reads.
      const legacy = createClient({ url: `file:${file}` });
      await legacy.executeMultiple(`
        DROP TABLE profiles;
        CREATE TABLE profiles (token TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
      `);
      await legacy.execute("INSERT INTO profiles (token, created_at) VALUES ('stale', 1)");
      await legacy.execute("UPDATE profiler_meta SET value = 99 WHERE key = 'schema_version'");
      legacy.close();

      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const b = new SqliteStorageAdapter({ path: file });
      await expect(b.findAll()).resolves.toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('schema v99'));

      // The recreated store is fully usable.
      await b.save(makeProfile('fresh'));
      expect((await b.findAll()).map((p) => p.token)).toEqual(['fresh']);

      warn.mockRestore();
      await b.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });
});
