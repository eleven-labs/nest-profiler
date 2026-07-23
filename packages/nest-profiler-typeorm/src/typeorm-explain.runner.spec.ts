import type { ModuleRef } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { ExplainRunnerRegistry } from '@eleven-labs/nest-profiler';
import { TypeOrmExplainRunner } from './typeorm-explain.runner';
import type { TypeOrmCollectorModuleOptions } from './typeorm-collector.interface';

interface QueryRunnerLike {
  query: jest.Mock;
  release: jest.Mock;
}

function makeDataSource(
  params: {
    type?: string;
    initialized?: boolean;
    rows?: unknown;
  } = {},
): { dataSource: DataSource; query: jest.Mock; release: jest.Mock } {
  const query = jest.fn(() => Promise.resolve(params.rows ?? []));
  const release = jest.fn(() => Promise.resolve());
  const runner: QueryRunnerLike = { query, release };
  const dataSource = {
    isInitialized: params.initialized !== false,
    options: { type: params.type ?? 'postgres' },
    createQueryRunner: jest.fn(() => runner),
  } as unknown as DataSource;
  return { dataSource, query, release };
}

function makeRegistry(): ExplainRunnerRegistry & { register: jest.Mock } {
  return { register: jest.fn() } as unknown as ExplainRunnerRegistry & { register: jest.Mock };
}

function makeModuleRef(registry: unknown, dataSource: unknown): ModuleRef {
  return {
    get: (token: unknown) => (token === ExplainRunnerRegistry ? registry : dataSource),
  } as unknown as ModuleRef;
}

function setup(
  params: {
    type?: string;
    initialized?: boolean;
    rows?: unknown;
    registry?: unknown;
    dataSource?: unknown;
    options?: TypeOrmCollectorModuleOptions;
  } = {},
): {
  runner: TypeOrmExplainRunner;
  registry: ExplainRunnerRegistry & { register: jest.Mock };
  query: jest.Mock;
  release: jest.Mock;
} {
  const registry =
    params.registry === undefined
      ? makeRegistry()
      : (params.registry as ExplainRunnerRegistry & { register: jest.Mock });
  const built = makeDataSource({
    type: params.type,
    initialized: params.initialized,
    rows: params.rows,
  });
  const dataSource = params.dataSource === undefined ? built.dataSource : params.dataSource;
  const moduleRef = makeModuleRef(
    params.registry === undefined ? registry : params.registry,
    dataSource,
  );
  const runner = new TypeOrmExplainRunner(moduleRef, params.options ?? {});
  return { runner, registry, query: built.query, release: built.release };
}

describe('TypeOrmExplainRunner', () => {
  describe('onModuleInit registration', () => {
    it('registers with the registry for a postgres DataSource', () => {
      const { runner, registry } = setup({ type: 'postgres' });
      runner.onModuleInit();
      expect(registry.register).toHaveBeenCalledWith(runner);
    });

    it('does not register when explain.enabled is false', () => {
      const { runner, registry } = setup({
        type: 'postgres',
        options: { explain: { enabled: false } },
      });
      runner.onModuleInit();
      expect(registry.register).not.toHaveBeenCalled();
    });

    it('does not register for an unsupported dialect', () => {
      const { runner, registry } = setup({ type: 'oracle' });
      runner.onModuleInit();
      expect(registry.register).not.toHaveBeenCalled();
    });

    it('does not register when the DataSource is not initialized', () => {
      const { runner, registry } = setup({ type: 'postgres', initialized: false });
      runner.onModuleInit();
      expect(registry.register).not.toHaveBeenCalled();
    });

    it('no-ops when the registry cannot be resolved', () => {
      const registry = makeRegistry();
      // moduleRef returns no registry (only a valid DataSource).
      const moduleRef = makeModuleRef(undefined, makeDataSource({ type: 'postgres' }).dataSource);
      const runner = new TypeOrmExplainRunner(moduleRef, {});
      expect(() => runner.onModuleInit()).not.toThrow();
      expect(registry.register).not.toHaveBeenCalled();
    });
  });

  describe('explain()', () => {
    it('builds EXPLAIN (FORMAT JSON) for postgres and returns the unwrapped plan', async () => {
      const rows = [{ 'QUERY PLAN': [{ Plan: { 'Node Type': 'Seq Scan' } }] }];
      const { runner, query, release } = setup({ type: 'postgres', rows });
      runner.onModuleInit();

      const result = await runner.explain('SELECT * FROM users', [1]);

      expect(query).toHaveBeenCalledWith('EXPLAIN (FORMAT JSON) SELECT * FROM users', [1]);
      expect(result).toEqual({
        dialect: 'postgres',
        analyzed: false,
        raw: [{ Plan: { 'Node Type': 'Seq Scan' } }],
      });
      expect(release).toHaveBeenCalled();
    });

    it('JSON.parses a stringified postgres QUERY PLAN column', async () => {
      const plan = [{ Plan: { 'Node Type': 'Index Scan' } }];
      const rows = [{ 'QUERY PLAN': JSON.stringify(plan) }];
      const { runner } = setup({ type: 'postgres', rows });
      runner.onModuleInit();

      const result = await runner.explain('SELECT 1', undefined);
      expect(result.raw).toEqual(plan);
    });

    it('builds EXPLAIN FORMAT=JSON for mysql and JSON.parses the EXPLAIN column string', async () => {
      const plan = { query_block: { select_id: 1 } };
      const rows = [{ EXPLAIN: JSON.stringify(plan) }];
      const { runner, query } = setup({ type: 'mysql', rows });
      runner.onModuleInit();

      const result = await runner.explain('SELECT * FROM users', []);

      expect(query).toHaveBeenCalledWith('EXPLAIN FORMAT=JSON SELECT * FROM users', []);
      expect(result).toEqual({ dialect: 'mysql', analyzed: false, raw: plan });
    });

    it('builds EXPLAIN QUERY PLAN for sqlite and returns rows as-is', async () => {
      const rows = [{ id: 0, parent: 0, detail: 'SCAN users' }];
      const { runner, query } = setup({ type: 'sqlite', rows });
      runner.onModuleInit();

      const result = await runner.explain('SELECT * FROM users', undefined);

      expect(query).toHaveBeenCalledWith('EXPLAIN QUERY PLAN SELECT * FROM users', []);
      expect(result).toEqual({ dialect: 'sqlite', analyzed: false, raw: rows });
    });

    it('releases the query runner even when the query rejects', async () => {
      const { dataSource, query, release } = makeDataSource({ type: 'postgres' });
      query.mockImplementation(() => Promise.reject(new Error('boom')));
      const moduleRef = makeModuleRef(makeRegistry(), dataSource);
      const runner = new TypeOrmExplainRunner(moduleRef, {});
      runner.onModuleInit();

      await expect(runner.explain('SELECT 1', undefined)).rejects.toThrow('boom');
      expect(release).toHaveBeenCalled();
    });
  });

  describe('explain() ANALYZE gating', () => {
    it('uses ANALYZE for a SELECT on postgres when analyze is true', async () => {
      const rows = [{ 'QUERY PLAN': [{ Plan: {} }] }];
      const { runner, query } = setup({
        type: 'postgres',
        rows,
        options: { explain: { analyze: true } },
      });
      runner.onModuleInit();

      const result = await runner.explain('SELECT * FROM users', undefined);

      expect(query).toHaveBeenCalledWith('EXPLAIN (ANALYZE, FORMAT JSON) SELECT * FROM users', []);
      expect(result.analyzed).toBe(true);
    });

    it('does NOT use ANALYZE for a write (INSERT/UPDATE) even when analyze is true', async () => {
      const rows = [{ 'QUERY PLAN': [{ Plan: {} }] }];
      const { runner, query } = setup({
        type: 'postgres',
        rows,
        options: { explain: { analyze: true } },
      });
      runner.onModuleInit();

      const result = await runner.explain('UPDATE users SET x = 1', undefined);

      expect(query).toHaveBeenCalledWith('EXPLAIN (FORMAT JSON) UPDATE users SET x = 1', []);
      expect(result.analyzed).toBe(false);
    });

    it('does NOT use ANALYZE for sqlite even for a SELECT with analyze true', async () => {
      const rows = [{ id: 0 }];
      const { runner, query } = setup({
        type: 'sqlite',
        rows,
        options: { explain: { analyze: true } },
      });
      runner.onModuleInit();

      const result = await runner.explain('SELECT * FROM users', undefined);

      expect(query).toHaveBeenCalledWith('EXPLAIN QUERY PLAN SELECT * FROM users', []);
      expect(result.analyzed).toBe(false);
    });
  });

  describe('explain() when unavailable', () => {
    it('throws a clear error if called before init', async () => {
      const moduleRef = makeModuleRef(
        makeRegistry(),
        makeDataSource({ type: 'postgres' }).dataSource,
      );
      const runner = new TypeOrmExplainRunner(moduleRef, {});
      await expect(runner.explain('SELECT 1', undefined)).rejects.toThrow(
        'EXPLAIN is not available for this connection.',
      );
    });

    it('throws when init found an unsupported dialect (never registered)', async () => {
      const { runner } = setup({ type: 'oracle' });
      runner.onModuleInit();
      await expect(runner.explain('SELECT 1', undefined)).rejects.toThrow(
        'EXPLAIN is not available for this connection.',
      );
    });
  });
});
