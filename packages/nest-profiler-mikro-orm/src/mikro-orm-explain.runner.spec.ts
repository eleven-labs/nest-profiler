import type { MikroORM } from '@mikro-orm/core';
import type { ModuleRef } from '@nestjs/core';

// MikroORM v7 is ESM-only; the runner imports `MikroORM` as a runtime DI token. Stub it so the
// CommonJS jest runtime never parses the real ESM entry (the runner is constructed directly here).
jest.mock('@mikro-orm/core', () => ({ MikroORM: class MikroORM {} }));
// @mikro-orm/nestjs is ESM-only too; stub the token helper used by the runner.
jest.mock('@mikro-orm/nestjs', () => ({ getMikroORMToken: (name: string) => `MikroORM_${name}` }));

import { ExplainRunnerRegistry } from '@eleven-labs/nest-profiler';
import { MikroOrmExplainRunner } from './mikro-orm-explain.runner.js';
import type { MikroOrmCollectorModuleOptions } from './mikro-orm-collector.interface.js';

class PostgreSqlPlatform {}
class MySqlPlatform {}
class SqlitePlatform {}
class OraclePlatform {}

interface ConnectionLike {
  execute: jest.Mock;
}

function makeOrm(params: { platform?: new () => object; rows?: unknown } = {}): {
  orm: MikroORM;
  execute: jest.Mock;
} {
  const execute = jest.fn(() => Promise.resolve(params.rows ?? []));
  const connection: ConnectionLike = { execute };
  const PlatformCtor = params.platform ?? PostgreSqlPlatform;
  const orm = {
    em: {
      getPlatform: () => new PlatformCtor(),
      getConnection: () => connection,
    },
  } as unknown as MikroORM;
  return { orm, execute };
}

function makeRegistry(): ExplainRunnerRegistry & { register: jest.Mock } {
  return { register: jest.fn() } as unknown as ExplainRunnerRegistry & { register: jest.Mock };
}

function makeModuleRef(registry: unknown, orm: unknown): ModuleRef {
  return {
    get: (token: unknown) => (token === ExplainRunnerRegistry ? registry : orm),
  } as unknown as ModuleRef;
}

function setup(
  params: {
    platform?: new () => object;
    rows?: unknown;
    registry?: unknown;
    orm?: unknown;
    hasOrm?: boolean;
    options?: MikroOrmCollectorModuleOptions;
  } = {},
): {
  runner: MikroOrmExplainRunner;
  registry: ExplainRunnerRegistry & { register: jest.Mock };
  execute: jest.Mock;
} {
  const registry =
    params.registry === undefined
      ? makeRegistry()
      : (params.registry as ExplainRunnerRegistry & { register: jest.Mock });
  const built = makeOrm({ platform: params.platform, rows: params.rows });
  const orm = params.hasOrm === false ? undefined : (params.orm ?? built.orm);
  const moduleRef = makeModuleRef(params.registry === undefined ? registry : params.registry, orm);
  const runner = new MikroOrmExplainRunner(moduleRef, params.options ?? {});
  return { runner, registry, execute: built.execute };
}

describe('MikroOrmExplainRunner', () => {
  describe('onModuleInit registration', () => {
    it('registers with the registry for a postgres platform', () => {
      const { runner, registry } = setup({ platform: PostgreSqlPlatform });
      runner.onModuleInit();
      expect(registry.register).toHaveBeenCalledWith(runner);
    });

    it('does not register when explain.enabled is false', () => {
      const { runner, registry } = setup({
        platform: PostgreSqlPlatform,
        options: { explain: { enabled: false } },
      });
      runner.onModuleInit();
      expect(registry.register).not.toHaveBeenCalled();
    });

    it('does not register for an unsupported platform', () => {
      const { runner, registry } = setup({ platform: OraclePlatform });
      runner.onModuleInit();
      expect(registry.register).not.toHaveBeenCalled();
    });

    it('no-ops when the ORM cannot be resolved', () => {
      const { runner, registry } = setup({ hasOrm: false });
      expect(() => runner.onModuleInit()).not.toThrow();
      expect(registry.register).not.toHaveBeenCalled();
    });

    it('no-ops when the registry cannot be resolved', () => {
      const registry = makeRegistry();
      const { orm } = makeOrm({ platform: PostgreSqlPlatform });
      const moduleRef = makeModuleRef(undefined, orm);
      const runner = new MikroOrmExplainRunner(moduleRef, {});
      expect(() => runner.onModuleInit()).not.toThrow();
      expect(registry.register).not.toHaveBeenCalled();
    });
  });

  describe('explain()', () => {
    it('builds EXPLAIN (FORMAT JSON) for postgres and calls execute with "all"', async () => {
      const rows = [{ 'QUERY PLAN': [{ Plan: { 'Node Type': 'Seq Scan' } }] }];
      const { runner, execute } = setup({ platform: PostgreSqlPlatform, rows });
      runner.onModuleInit();

      const result = await runner.explain('SELECT * FROM users', [1]);

      expect(execute).toHaveBeenCalledWith('EXPLAIN (FORMAT JSON) SELECT * FROM users', [1], 'all');
      expect(result).toEqual({
        dialect: 'postgres',
        analyzed: false,
        raw: [{ Plan: { 'Node Type': 'Seq Scan' } }],
      });
    });

    it('JSON.parses a stringified postgres QUERY PLAN column', async () => {
      const plan = [{ Plan: { 'Node Type': 'Index Scan' } }];
      const rows = [{ 'QUERY PLAN': JSON.stringify(plan) }];
      const { runner } = setup({ platform: PostgreSqlPlatform, rows });
      runner.onModuleInit();

      const result = await runner.explain('SELECT 1', undefined);
      expect(result.raw).toEqual(plan);
    });

    it('builds EXPLAIN FORMAT=JSON for mysql and JSON.parses the EXPLAIN column string', async () => {
      const plan = { query_block: { select_id: 1 } };
      const rows = [{ EXPLAIN: JSON.stringify(plan) }];
      const { runner, execute } = setup({ platform: MySqlPlatform, rows });
      runner.onModuleInit();

      const result = await runner.explain('SELECT * FROM users', []);

      expect(execute).toHaveBeenCalledWith('EXPLAIN FORMAT=JSON SELECT * FROM users', [], 'all');
      expect(result).toEqual({ dialect: 'mysql', analyzed: false, raw: plan });
    });

    it('builds EXPLAIN QUERY PLAN for sqlite and returns rows as-is', async () => {
      const rows = [{ id: 0, parent: 0, detail: 'SCAN users' }];
      const { runner, execute } = setup({ platform: SqlitePlatform, rows });
      runner.onModuleInit();

      const result = await runner.explain('SELECT * FROM users', undefined);

      expect(execute).toHaveBeenCalledWith('EXPLAIN QUERY PLAN SELECT * FROM users', [], 'all');
      expect(result).toEqual({ dialect: 'sqlite', analyzed: false, raw: rows });
    });
  });

  describe('explain() ANALYZE gating', () => {
    it('uses ANALYZE for a SELECT on postgres when analyze is true', async () => {
      const rows = [{ 'QUERY PLAN': [{ Plan: {} }] }];
      const { runner, execute } = setup({
        platform: PostgreSqlPlatform,
        rows,
        options: { explain: { analyze: true } },
      });
      runner.onModuleInit();

      const result = await runner.explain('SELECT * FROM users', undefined);

      expect(execute).toHaveBeenCalledWith(
        'EXPLAIN (ANALYZE, FORMAT JSON) SELECT * FROM users',
        [],
        'all',
      );
      expect(result.analyzed).toBe(true);
    });

    it('does NOT use ANALYZE for a write (INSERT/UPDATE) even when analyze is true', async () => {
      const rows = [{ 'QUERY PLAN': [{ Plan: {} }] }];
      const { runner, execute } = setup({
        platform: PostgreSqlPlatform,
        rows,
        options: { explain: { analyze: true } },
      });
      runner.onModuleInit();

      const result = await runner.explain('INSERT INTO users VALUES (1)', undefined);

      expect(execute).toHaveBeenCalledWith(
        'EXPLAIN (FORMAT JSON) INSERT INTO users VALUES (1)',
        [],
        'all',
      );
      expect(result.analyzed).toBe(false);
    });

    it('does NOT use ANALYZE for sqlite even for a SELECT with analyze true', async () => {
      const rows = [{ id: 0 }];
      const { runner, execute } = setup({
        platform: SqlitePlatform,
        rows,
        options: { explain: { analyze: true } },
      });
      runner.onModuleInit();

      const result = await runner.explain('SELECT * FROM users', undefined);

      expect(execute).toHaveBeenCalledWith('EXPLAIN QUERY PLAN SELECT * FROM users', [], 'all');
      expect(result.analyzed).toBe(false);
    });
  });

  describe('explain() when unavailable', () => {
    it('throws a clear error if called before init', async () => {
      const { orm } = makeOrm({ platform: PostgreSqlPlatform });
      const moduleRef = makeModuleRef(makeRegistry(), orm);
      const runner = new MikroOrmExplainRunner(moduleRef, {});
      await expect(runner.explain('SELECT 1', undefined)).rejects.toThrow(
        'EXPLAIN is not available for this connection.',
      );
    });

    it('throws when init found an unsupported platform (never registered)', async () => {
      const { runner } = setup({ platform: OraclePlatform });
      runner.onModuleInit();
      await expect(runner.explain('SELECT 1', undefined)).rejects.toThrow(
        'EXPLAIN is not available for this connection.',
      );
    });
  });
});
