import * as path from 'path';
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
    isSlow: false,
    startedAt: Date.now(),
    ...overrides,
  };
}

describe('TypeOrmCollector', () => {
  let collector: TypeOrmCollector;

  beforeEach(() => {
    collector = new TypeOrmCollector();
  });

  it('returns the private queries key and removes it from collectors', () => {
    const q = makeQuery();
    const profile = makeProfile({ collectors: { [TYPEORM_QUERIES_KEY]: [q] } });
    const result = collector.collect(profile);
    expect(result).toEqual([q]);
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

  it('getBadgeValue includes slow count when present', () => {
    const slow = makeQuery({ isSlow: true });
    const fast = makeQuery();
    const profile = makeProfile({ collectors: { [TYPEORM_QUERIES_KEY]: [slow, fast] } });
    expect(collector.getBadgeValue(profile)).toBe('2q (1 slow)');
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
  }

  function setup(
    params: {
      queryImpl?: (...args: unknown[]) => Promise<unknown>;
      initialized?: boolean;
      threshold?: number;
      profile?: Profile | null;
      clsThrows?: boolean;
    } = {},
  ): {
    dataSource: DataSource & { createQueryRunner: () => QueryRunnerLike };
    profile: Profile | null;
  } {
    const queryFn = jest.fn(params.queryImpl ?? (() => Promise.resolve([{ id: 1 }])));
    const qr: QueryRunnerLike = { query: queryFn };
    const dataSource = {
      isInitialized: params.initialized !== false,
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
    const patch = new TypeOrmDriverPatch(moduleRef, { slowQueryThreshold: params.threshold });
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
    const { dataSource, profile } = setup({ threshold: 100 });
    const result: unknown = await dataSource.createQueryRunner().query('SELECT * FROM users', [1]);
    expect(result).toEqual([{ id: 1 }]);

    const e = firstEntry(profile);
    expect(e.sql).toBe('SELECT * FROM users');
    expect(e.parameters).toEqual([1]);
    expect(e.type).toBe('SELECT');
    expect(e.isSlow).toBe(false);
    expect(e.error).toBeUndefined();
  });

  it('defaults parameters to an empty array when none are passed', async () => {
    const { dataSource, profile } = setup({});
    await dataSource.createQueryRunner().query('UPDATE users SET x = 1');
    expect(firstEntry(profile).parameters).toEqual([]);
  });

  it('flags slow queries when the duration meets the threshold', async () => {
    const { dataSource, profile } = setup({ threshold: 0 });
    await dataSource.createQueryRunner().query('SELECT 1');
    expect(firstEntry(profile).isSlow).toBe(true);
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

  it('uses the default threshold when no options are provided', async () => {
    const queryFn = jest.fn(() => Promise.resolve([{ id: 1 }]));
    const qr = { query: queryFn };
    const dataSource = {
      isInitialized: true,
      createQueryRunner: jest.fn(() => qr),
    } as unknown as DataSource & { createQueryRunner: () => QueryRunnerLike };
    const profile = makeProfile();
    const cls = { get: jest.fn(() => profile) } as unknown as ClsService;
    // Third argument omitted → exercises the default `options = {}` parameter.
    const moduleRef = {
      get: (t: unknown) => (t === ClsService ? cls : dataSource),
    } as unknown as ModuleRef;
    const patch = new TypeOrmDriverPatch(moduleRef, {});
    patch.onModuleInit();

    await dataSource.createQueryRunner().query('SELECT 1');
    expect(firstEntry(profile).isSlow).toBe(false);
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
