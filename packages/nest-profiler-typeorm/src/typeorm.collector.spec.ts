import * as path from 'path';
import { Readable } from 'stream';
import type { ModuleRef } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TypeOrmCollector } from './typeorm.collector';
import { TypeOrmCollectorModule } from './typeorm-collector.module';
import { TYPEORM_QUERIES_KEY, TypeOrmDriverPatch } from './typeorm-driver.patch';
import { detectQueryType } from './typeorm-collector.interface';
import type { Profile } from '@eleven-labs/nest-profiler';
import type { QueryEntry } from './typeorm-collector.interface';

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

function makeQuery(overrides: Partial<QueryEntry> = {}): QueryEntry {
  return {
    sql: 'SELECT * FROM users',
    duration: 10,
    type: 'SELECT',
    startedAt: Date.now(),
    ...overrides,
  };
}

const slowTag = { id: 'slow', label: 'Slow', severity: 'warning' as const };

describe('TypeOrmCollector', () => {
  let collector: TypeOrmCollector;

  beforeEach(() => {
    collector = new TypeOrmCollector();
  });

  it('returns the private queries key and removes it from collectors', () => {
    const q = makeQuery();
    const profile = makeProfile({ collectors: { [TYPEORM_QUERIES_KEY]: [q] } });
    const result = collector.collect(profile);
    expect(result).toEqual([{ ...q, fingerprint: 'SELECT * FROM users' }]);
    expect(profile.collectors[TYPEORM_QUERIES_KEY]).toBeUndefined();
  });

  it('returns empty array when no queries', () => {
    const profile = makeProfile();
    expect(collector.collect(profile)).toEqual([]);
  });

  it('getBadgeValue returns null when no queries', () => {
    const profile = makeProfile();
    expect(collector.getBadgeValue(profile)).toBeNull();
  });

  it('getBadgeValue shows query count', () => {
    const q = makeQuery();
    const profile = makeProfile({ collectors: { [TYPEORM_QUERIES_KEY]: [q, q] } });
    expect(collector.getBadgeValue(profile)).toBe('2q');
  });

  it('getBadgeValue is a plain query count; getBadgeSeverity reflects the tags', () => {
    const slow = makeQuery({ tags: [slowTag] });
    const fast = makeQuery();
    const profile = makeProfile({ collectors: { [TYPEORM_QUERIES_KEY]: [slow, fast] } });
    expect(collector.getBadgeValue(profile)).toBe('2q');
    expect(collector.getBadgeSeverity(profile)).toBe('warning');
  });

  it('collect() stamps a parameter-free fingerprint on each query', () => {
    const a = makeQuery({ sql: 'SELECT * FROM users WHERE id = 1' });
    const b = makeQuery({ sql: 'SELECT * FROM users WHERE id = 2' });
    const profile = makeProfile({ collectors: { [TYPEORM_QUERIES_KEY]: [a, b] } });
    const [fa, fb] = collector.collect(profile);
    expect(fa?.fingerprint).toBe('SELECT * FROM users WHERE id = ?');
    expect(fa?.fingerprint).toBe(fb?.fingerprint);
  });

  it('getTagConfig returns defaults, and the configured thresholds when provided', () => {
    expect(new TypeOrmCollector().getTagConfig()).toMatchObject({
      slowThreshold: 100,
      nPlusOneThreshold: 2,
      chattyThreshold: 20,
    });
    expect(
      new TypeOrmCollector({ slowThreshold: 25, nPlusOneThreshold: 3 }).getTagConfig(),
    ).toMatchObject({ slowThreshold: 25, nPlusOneThreshold: 3 });
  });

  it('getTagConfig passes configured severities through', () => {
    expect(
      new TypeOrmCollector({
        slowSeverity: 'danger',
        nPlusOneSeverity: 'warning',
        chattySeverity: 'info',
        zeroRowsSeverity: 'danger',
      }).getTagConfig(),
    ).toMatchObject({
      slowSeverity: 'danger',
      nPlusOneSeverity: 'warning',
      chattySeverity: 'info',
      zeroRowsSeverity: 'danger',
    });
  });

  it('getBadgeValue reads from profile.collectors[name] after collect() has run', () => {
    const q = makeQuery();
    const profile = makeProfile({ collectors: { [TYPEORM_QUERIES_KEY]: [q, q] } });
    const collected = collector.collect(profile);
    profile.collectors[collector.name] = collected; // simulates what collectAll() does
    expect(profile.collectors[TYPEORM_QUERIES_KEY]).toBeUndefined();
    expect(collector.getBadgeValue(profile)).toBe('2q');
  });

  it('getTemplatePath returns an absolute path ending with sql-panel.ejs', () => {
    const p = collector.getTemplatePath();
    expect(p).toMatch(/sql-panel\.ejs$/);
    expect(path.isAbsolute(p)).toBe(true);
  });
});

describe('TypeOrmCollectorModule.forRoot', () => {
  it('returns a no-op module when enabled is false', () => {
    expect(TypeOrmCollectorModule.forRoot({ enabled: false })).toEqual({
      module: TypeOrmCollectorModule,
    });
  });

  it('registers providers by default', () => {
    expect(TypeOrmCollectorModule.forRoot().providers?.length ?? 0).toBeGreaterThan(0);
  });

  it('warns and no-ops when the named DataSource is absent (MAJ-18/MIN-20)', () => {
    const cls = { get: jest.fn() } as unknown as ClsService;
    // moduleRef resolves cls but not the named DataSource token → undefined.
    const moduleRef = {
      get: (t: unknown) => (t === ClsService ? cls : undefined),
    } as unknown as ModuleRef;
    const patch = new TypeOrmDriverPatch(moduleRef, { connectionName: 'analytics' });
    expect(() => patch.onModuleInit()).not.toThrow();
  });

  it('warns and no-ops when the DataSource is not initialized', () => {
    const cls = { get: jest.fn() } as unknown as ClsService;
    const dataSource = { isInitialized: false } as unknown as DataSource;
    const moduleRef = {
      get: (t: unknown) => (t === ClsService ? cls : dataSource),
    } as unknown as ModuleRef;
    const patch = new TypeOrmDriverPatch(moduleRef, {});
    expect(() => patch.onModuleInit()).not.toThrow();
  });

  it('no-ops silently when the profiler core is disabled (no ClsService)', () => {
    const moduleRef = { get: () => undefined } as unknown as ModuleRef;
    const patch = new TypeOrmDriverPatch(moduleRef, {});
    expect(() => patch.onModuleInit()).not.toThrow();
  });

  it('no-ops silently when the default DataSource is absent (no connectionName, no warn)', () => {
    const cls = { get: jest.fn() } as unknown as ClsService;
    const moduleRef = {
      get: (t: unknown) => (t === ClsService ? cls : undefined),
    } as unknown as ModuleRef;
    const patch = new TypeOrmDriverPatch(moduleRef, {});
    expect(() => patch.onModuleInit()).not.toThrow();
  });
});

describe('detectQueryType', () => {
  it.each([
    ['SELECT * FROM users', 'SELECT'],
    ['INSERT INTO users VALUES (1)', 'INSERT'],
    ['UPDATE users SET x = 1', 'UPDATE'],
    ['DELETE FROM users', 'DELETE'],
    ['BEGIN TRANSACTION', 'OTHER'],
  ])('classifies %s as %s', (sql, expected) => {
    expect(detectQueryType(sql)).toBe(expected);
  });

  it('trims leading whitespace and is case-insensitive', () => {
    expect(detectQueryType('   select 1')).toBe('SELECT');
  });
});

describe('TypeOrmDriverPatch', () => {
  interface QueryRunnerLike {
    query: (...args: unknown[]) => Promise<unknown>;
    stream?: (...args: unknown[]) => Promise<unknown>;
  }

  function setup(
    params: {
      queryImpl?: (...args: unknown[]) => Promise<unknown>;
      streamImpl?: (...args: unknown[]) => Promise<unknown>;
      initialized?: boolean;
      profile?: Profile | null;
      clsThrows?: boolean;
      options?: Record<string, unknown>;
    } = {},
  ): {
    dataSource: DataSource & { createQueryRunner: () => QueryRunnerLike };
    profile: Profile | null;
  } {
    const queryFn = jest.fn(params.queryImpl ?? (() => Promise.resolve([{ id: 1 }])));
    const qr: QueryRunnerLike = { query: queryFn };
    if (params.streamImpl) qr.stream = jest.fn(params.streamImpl);
    const dataSource = {
      isInitialized: params.initialized !== false,
      options: params.options ?? { host: 'localhost', port: 5432, database: 'testdb' },
      createQueryRunner: jest.fn(() => qr),
    } as unknown as DataSource & { createQueryRunner: () => QueryRunnerLike };

    const profile = params.profile === undefined ? makeProfile() : params.profile;
    const cls = {
      get: jest.fn(() => {
        if (params.clsThrows) throw new Error('outside CLS');
        return profile ?? undefined;
      }),
    } as unknown as ClsService;

    const moduleRef = {
      get: (token: unknown) => (token === ClsService ? cls : dataSource),
    } as unknown as ModuleRef;
    const patch = new TypeOrmDriverPatch(moduleRef, {});
    patch.onModuleInit();
    return { dataSource, profile };
  }

  function entriesOf(profile: Profile | null): QueryEntry[] {
    return (profile?.collectors[TYPEORM_QUERIES_KEY] as QueryEntry[] | undefined) ?? [];
  }

  function firstEntry(profile: Profile | null): QueryEntry {
    const first = entriesOf(profile)[0];
    if (first === undefined) throw new Error('expected at least one collected query');
    return first;
  }

  it('does not patch the data source when it is not initialized', async () => {
    const { dataSource, profile } = setup({ initialized: false });
    await dataSource.createQueryRunner().query('SELECT 1', [1]);
    expect(entriesOf(profile)).toHaveLength(0);
  });

  it('captures sql, parameters, type and duration for a query', async () => {
    const { dataSource, profile } = setup({});
    const result: unknown = await dataSource.createQueryRunner().query('SELECT * FROM users', [1]);
    expect(result).toEqual([{ id: 1 }]);

    const e = firstEntry(profile);
    expect(e.sql).toBe('SELECT * FROM users');
    expect(e.parameters).toEqual([1]);
    expect(e.type).toBe('SELECT');
    expect(typeof e.duration).toBe('number');
    expect(e.error).toBeUndefined();
  });

  it('defaults parameters to an empty array when none are passed', async () => {
    const { dataSource, profile } = setup({});
    await dataSource.createQueryRunner().query('UPDATE users SET x = 1');
    expect(firstEntry(profile).parameters).toEqual([]);
  });

  it('derives rowCount from an array result (a read result-set)', async () => {
    const { dataSource, profile } = setup({
      queryImpl: () => Promise.resolve([{ id: 1 }, { id: 2 }, { id: 3 }]),
    });
    await dataSource.createQueryRunner().query('SELECT * FROM users');
    expect(firstEntry(profile).rowCount).toBe(3);
  });

  it('derives rowCount from a QueryResult-like affected count', async () => {
    const { dataSource, profile } = setup({
      queryImpl: () => Promise.resolve({ raw: [], records: [], affected: 0 }),
    });
    await dataSource.createQueryRunner().query('UPDATE users SET x = 1 WHERE id = 999');
    expect(firstEntry(profile).rowCount).toBe(0);
  });

  it('derives rowCount from a structured QueryResult read (records array)', async () => {
    const { dataSource, profile } = setup({
      queryImpl: () =>
        Promise.resolve({ records: [{ id: 1 }, { id: 2 }], raw: [{ id: 1 }, { id: 2 }] }),
    });
    await dataSource.createQueryRunner().query('SELECT id FROM job');
    expect(firstEntry(profile).rowCount).toBe(2);
  });

  it('falls back to the raw array when a structured QueryResult has no records', async () => {
    const { dataSource, profile } = setup({
      queryImpl: () => Promise.resolve({ raw: [{ id: 1 }, { id: 2 }, { id: 3 }] }),
    });
    await dataSource.createQueryRunner().query('SELECT id FROM job');
    expect(firstEntry(profile).rowCount).toBe(3);
  });

  it('derives rowCount from a better-sqlite3-style changes count', async () => {
    const { dataSource, profile } = setup({
      queryImpl: () => Promise.resolve({ changes: 2, lastInsertRowid: 5 }),
    });
    await dataSource.createQueryRunner().query('DELETE FROM users WHERE active = 0');
    expect(firstEntry(profile).rowCount).toBe(2);
  });

  it('leaves rowCount undefined when the driver result exposes none', async () => {
    const { dataSource, profile } = setup({ queryImpl: () => Promise.resolve(undefined) });
    await dataSource.createQueryRunner().query('UPDATE users SET x = 1');
    expect(firstEntry(profile).rowCount).toBeUndefined();
  });

  it('captures connection and database from the DataSource options', async () => {
    const { dataSource, profile } = setup({});
    await dataSource.createQueryRunner().query('SELECT 1');
    const e = firstEntry(profile);
    expect(e.connection).toBe('localhost:5432');
    expect(e.database).toBe('testdb');
  });

  it('omits connection when the driver has no host/port (e.g. sqlite)', async () => {
    const { dataSource, profile } = setup({ options: { database: '/tmp/app.sqlite' } });
    await dataSource.createQueryRunner().query('SELECT 1');
    const e = firstEntry(profile);
    expect(e.connection).toBeUndefined();
    expect(e.database).toBe('/tmp/app.sqlite');
  });

  it('records the error message and rethrows when a query fails', async () => {
    const { dataSource, profile } = setup({
      queryImpl: () => Promise.reject(new Error('syntax error')),
    });
    await expect(dataSource.createQueryRunner().query('SELECT bad')).rejects.toThrow(
      'syntax error',
    );
    expect(firstEntry(profile).error).toBe('syntax error');
  });

  it('stringifies a non-Error rejection', async () => {
    const { dataSource, profile } = setup({
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- testing the non-Error branch
      queryImpl: () => Promise.reject('boom'),
    });
    await expect(dataSource.createQueryRunner().query('SELECT 1')).rejects.toBe('boom');
    expect(firstEntry(profile).error).toBe('boom');
  });

  it('does not append outside a CLS context', async () => {
    const { dataSource, profile } = setup({ clsThrows: true });
    await dataSource.createQueryRunner().query('SELECT 1');
    expect(entriesOf(profile)).toHaveLength(0);
  });

  it('does not append when there is no active profile', async () => {
    const { dataSource, profile } = setup({ profile: null });
    await dataSource.createQueryRunner().query('SELECT 1');
    expect(profile).toBeNull();
  });

  it('captures a streaming read with streaming:true when the stream ends', async () => {
    const { dataSource, profile } = setup({
      streamImpl: () => Promise.resolve(Readable.from([{ id: 1 }, { id: 2 }])),
    });
    const stream = (await dataSource
      .createQueryRunner()
      .stream?.('SELECT * FROM users', [1])) as Readable;
    await new Promise<void>((resolve) => {
      stream.on('data', () => {});
      stream.on('end', () => resolve());
    });

    const e = firstEntry(profile);
    expect(e.sql).toBe('SELECT * FROM users');
    expect(e.parameters).toEqual([1]);
    expect(e.type).toBe('SELECT');
    expect(e.streaming).toBe(true);
    expect(e.error).toBeUndefined();
    expect(e.duration).toBeGreaterThanOrEqual(0);
  });

  it('records the error and streaming:true when the stream emits an error', async () => {
    const bad = new Readable({ read() {} });
    const { dataSource, profile } = setup({ streamImpl: () => Promise.resolve(bad) });
    const stream = (await dataSource.createQueryRunner().stream?.('SELECT x')) as Readable;
    const done = new Promise<void>((resolve) => stream.on('error', () => resolve()));
    bad.destroy(new Error('stream boom'));
    await done;

    const e = firstEntry(profile);
    expect(e.error).toBe('stream boom');
    expect(e.streaming).toBe(true);
  });

  it('records the error and rethrows when stream() itself rejects', async () => {
    const { dataSource, profile } = setup({
      streamImpl: () => Promise.reject(new Error('open fail')),
    });
    await expect(dataSource.createQueryRunner().stream?.('SELECT x')).rejects.toThrow('open fail');

    const e = firstEntry(profile);
    expect(e.error).toBe('open fail');
    expect(e.streaming).toBe(true);
  });

  it('records a streamed query only once for a re-used (memoised) runner', async () => {
    const { dataSource, profile } = setup({
      streamImpl: () => Promise.resolve(Readable.from([{ id: 1 }])),
    });
    // Same qr instance is returned on every createQueryRunner() call (SQLite-style memoisation).
    dataSource.createQueryRunner();
    const stream = (await dataSource.createQueryRunner().stream?.('SELECT 1')) as Readable;
    await new Promise<void>((resolve) => {
      stream.on('data', () => {});
      stream.on('end', () => resolve());
    });
    expect(entriesOf(profile).filter((e) => e.streaming)).toHaveLength(1);
  });

  it('does not double-wrap createQueryRunner when onModuleInit runs twice', async () => {
    const queryFn = jest.fn(() => Promise.resolve([{ id: 1 }]));
    const qr = { query: queryFn };
    const dataSource = {
      isInitialized: true,
      createQueryRunner: jest.fn(() => qr),
    } as unknown as DataSource & { createQueryRunner: () => QueryRunnerLike };
    const profile = makeProfile();
    const cls = { get: jest.fn(() => profile) } as unknown as ClsService;
    const moduleRef = {
      get: (t: unknown) => (t === ClsService ? cls : dataSource),
    } as unknown as ModuleRef;
    const patch = new TypeOrmDriverPatch(moduleRef, {});
    patch.onModuleInit();
    patch.onModuleInit(); // second init must be a no-op (idempotency guard)

    await dataSource.createQueryRunner().query('SELECT 1', [1]);
    expect(entriesOf(profile)).toHaveLength(1);
  });
});
