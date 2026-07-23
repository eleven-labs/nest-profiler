import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { ModuleRef } from '@nestjs/core';
import { ExplainRunnerRegistry, parseExplainPlan } from '@eleven-labs/nest-profiler';
import { TypeOrmExplainRunner } from './typeorm-explain.runner';

/**
 * Real-driver integration: the runner executes `EXPLAIN QUERY PLAN` against a live TypeORM
 * `DataSource` backed by an in-memory better-sqlite3 database, and the raw output is normalized
 * by the core parser end-to-end — exercising the true execute → unwrap → parse path (no mocks).
 */
describe('TypeOrmExplainRunner (real better-sqlite3 integration)', () => {
  let dataSource: DataSource;
  let registry: ExplainRunnerRegistry;
  let runner: TypeOrmExplainRunner;

  beforeEach(async () => {
    dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [] });
    await dataSource.initialize();

    const qr = dataSource.createQueryRunner();
    await qr.query('CREATE TABLE widget (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
    await qr.query("INSERT INTO widget (name) VALUES ('a'), ('b'), ('c')");
    await qr.release();

    registry = new ExplainRunnerRegistry();
    const moduleRef = {
      get: (token: unknown) =>
        token === ExplainRunnerRegistry
          ? registry
          : token === getDataSourceToken()
            ? dataSource
            : undefined,
    } as unknown as ModuleRef;

    runner = new TypeOrmExplainRunner(moduleRef, { explain: { enabled: true } });
    runner.onModuleInit();
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('registers itself for the sqlite DataSource', () => {
    expect(registry.get('typeorm')).toBe(runner);
  });

  it('runs EXPLAIN QUERY PLAN and the parser flags the full-table scan', async () => {
    const result = await runner.explain('SELECT * FROM widget WHERE name = ?', ['a']);
    expect(result.dialect).toBe('sqlite');
    expect(result.analyzed).toBe(false);

    const plan = parseExplainPlan(result);
    // No index on `name`, so SQLite plans a full SCAN of `widget`.
    expect(plan.hasSeqScan).toBe(true);
    expect(plan.seqScanRelations).toContain('widget');
  });

  it('does not flag a primary-key lookup as a full scan', async () => {
    const result = await runner.explain('SELECT * FROM widget WHERE id = ?', [1]);
    const plan = parseExplainPlan(result);
    expect(plan.hasSeqScan).toBe(false);
  });
});
