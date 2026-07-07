import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { ModuleRef } from '@nestjs/core';
import { TYPEORM_QUERIES_KEY, TypeOrmDriverPatch } from './typeorm-driver.patch';
import type { QueryEntry } from './typeorm-collector.interface';
import type { Profile } from '@eleven-labs/nest-profiler';

/**
 * Real-driver integration: instead of mocking `createQueryRunner`/`query`, the patch runs
 * against a live TypeORM `DataSource` backed by an in-memory better-sqlite3 database. Queries
 * are executed for real through the patched driver inside a CLS context, exercising the whole
 * capture path (async context propagation, redaction, error handling) end-to-end.
 */

function makeProfile(): Profile {
  return {
    token: 'it-token',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

function entriesOf(profile: Profile): QueryEntry[] {
  return (profile.collectors[TYPEORM_QUERIES_KEY] as QueryEntry[] | undefined) ?? [];
}

describe('TypeOrmDriverPatch (real better-sqlite3 integration)', () => {
  let dataSource: DataSource;
  let cls: ClsService;

  beforeEach(async () => {
    dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [] });
    await dataSource.initialize();

    // A real ClsService whose async context the patched query() must see through.
    const moduleRef = await Test.createTestingModule({ imports: [ClsModule.forRoot()] }).compile();
    cls = moduleRef.get(ClsService);

    const patchModuleRef = {
      get: (token: unknown) =>
        token === ClsService ? cls : token === getDataSourceToken() ? dataSource : undefined,
    } as unknown as ModuleRef;
    new TypeOrmDriverPatch(patchModuleRef, { slowQueryThreshold: 100 }).onModuleInit();

    await dataSource
      .createQueryRunner()
      .query('CREATE TABLE widget (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('captures real SELECT/INSERT queries with sql, type, params and duration', async () => {
    const profile = makeProfile();

    const rows = await cls.run(async (): Promise<unknown> => {
      cls.set('profiler.profile', profile);
      const qr = dataSource.createQueryRunner();
      await qr.query('INSERT INTO widget (name) VALUES (?)', ['hammer']);
      return (await qr.query('SELECT * FROM widget WHERE name = ?', ['hammer'])) as unknown;
    });

    expect(rows).toEqual([{ id: 1, name: 'hammer' }]);

    const entries = entriesOf(profile);
    const insert = entries.find((e) => e.type === 'INSERT');
    const select = entries.find((e) => e.type === 'SELECT');

    expect(insert?.sql).toContain('INSERT INTO widget');
    expect(insert?.parameters).toEqual(['hammer']);
    expect(select?.sql).toContain('SELECT * FROM widget');
    expect(select?.error).toBeUndefined();
    for (const e of entries) {
      expect(e.duration).toBeGreaterThanOrEqual(0);
      expect(e.isSlow).toBe(false);
      expect(typeof e.startedAt).toBe('number');
    }
  });

  it('records the driver error and rethrows when a real query fails', async () => {
    const profile = makeProfile();

    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      const qr = dataSource.createQueryRunner();
      await expect(qr.query('SELECT * FROM does_not_exist')).rejects.toThrow(/does_not_exist/);
    });

    const failed = entriesOf(profile).find((e) => e.error !== undefined);
    expect(failed?.error).toMatch(/does_not_exist/);
  });

  it('redacts credentials embedded in real bound parameters', async () => {
    const profile = makeProfile();

    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      const qr = dataSource.createQueryRunner();
      await qr.query('INSERT INTO widget (name) VALUES (?)', [
        'postgres://admin:s3cr3t@db:5432/app',
      ]);
    });

    const insert = entriesOf(profile).find((e) => e.type === 'INSERT');
    const serialized = JSON.stringify(insert?.parameters);
    expect(serialized).not.toContain('s3cr3t');
    expect(serialized).toContain('[REDACTED]');
  });

  it('does not double-wrap the driver when onModuleInit runs twice', async () => {
    const patchModuleRef = {
      get: (token: unknown) =>
        token === ClsService ? cls : token === getDataSourceToken() ? dataSource : undefined,
    } as unknown as ModuleRef;
    // A second patch instance re-initialising must be a no-op (the __profilerPatched guard).
    new TypeOrmDriverPatch(patchModuleRef, {}).onModuleInit();

    const profile = makeProfile();
    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      await dataSource.createQueryRunner().query('SELECT 1');
    });

    expect(entriesOf(profile).filter((e) => e.sql === 'SELECT 1')).toHaveLength(1);
  });
});
