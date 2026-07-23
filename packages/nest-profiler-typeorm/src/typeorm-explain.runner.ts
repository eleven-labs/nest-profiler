import { Inject, Injectable, Logger, Optional, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { ExplainDialect, ExplainRawResult, ExplainRunner } from '@eleven-labs/nest-profiler';
import { ExplainRunnerRegistry, detectQueryType, tryResolve } from '@eleven-labs/nest-profiler';
import { TYPEORM_COLLECTOR_OPTIONS } from './typeorm-collector.interface';
import type { TypeOrmCollectorModuleOptions } from './typeorm-collector.interface';

/** Maps a TypeORM `DataSource.options.type` to a supported EXPLAIN dialect (or `null`). */
function toDialect(type: string | undefined): ExplainDialect | null {
  switch (type) {
    case 'postgres':
    case 'aurora-postgres':
      return 'postgres';
    case 'mysql':
    case 'mariadb':
    case 'aurora-mysql':
      return 'mysql';
    case 'sqlite':
    case 'better-sqlite3':
    case 'sqljs':
    case 'expo':
    case 'capacitor':
      return 'sqlite';
    default:
      return null;
  }
}

/**
 * Runs `EXPLAIN` for the TypeORM collector's queries, on demand, over the instrumented
 * DataSource. Registered with the core {@link ExplainRunnerRegistry} on init — only when
 * `explain.enabled` is not `false` and the DataSource dialect is supported — which is what
 * makes the SQL panel's "Explain" action appear. Nothing runs until a user clicks it, so
 * the profiled request is never slowed. `EXPLAIN` alone does not execute the statement;
 * `ANALYZE` (opt-in) is restricted to `SELECT`.
 */
@Injectable()
export class TypeOrmExplainRunner implements ExplainRunner, OnModuleInit {
  readonly collectorName = 'typeorm';
  private readonly logger = new Logger(TypeOrmExplainRunner.name);
  private dataSource: DataSource | undefined;
  private dialect: ExplainDialect | null = null;

  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(TYPEORM_COLLECTOR_OPTIONS)
    private readonly options: TypeOrmCollectorModuleOptions = {},
  ) {}

  onModuleInit(): void {
    if (this.options.explain?.enabled === false) return;

    // Resolve the core registry lazily (like the driver patch resolves ClsService): it may be
    // out of the collector's injector scope, or absent entirely under the no-op core — no-op then.
    const registry = tryResolve<ExplainRunnerRegistry>(this.moduleRef, ExplainRunnerRegistry);
    if (!registry) return;

    const dataSource = tryResolve<DataSource>(
      this.moduleRef,
      getDataSourceToken(this.options.connectionName),
    );
    if (!dataSource?.isInitialized) return;

    const dialect = toDialect((dataSource.options as { type?: string }).type);
    if (!dialect) return; // Unsupported dialect — no "Explain" action for this collector.

    this.dataSource = dataSource;
    this.dialect = dialect;
    registry.register(this);
  }

  async explain(
    sql: string,
    parameters: readonly unknown[] | undefined,
  ): Promise<ExplainRawResult> {
    const dataSource = this.dataSource;
    const dialect = this.dialect;
    if (!dataSource || !dialect) throw new Error('EXPLAIN is not available for this connection.');

    // ANALYZE executes the query — restrict it to SELECT so writes are never re-run.
    const analyzed =
      this.options.explain?.analyze === true &&
      detectQueryType(sql) === 'SELECT' &&
      dialect !== 'sqlite';

    const explainSql = buildExplainSql(dialect, sql, analyzed);
    const runner = dataSource.createQueryRunner();
    try {
      const rows: unknown = await runner.query(explainSql, parameters ? [...parameters] : []);
      return { dialect, analyzed, raw: normalizeRaw(dialect, rows) };
    } finally {
      await runner.release().catch((err: unknown) => {
        this.logger.debug(`Failed to release EXPLAIN query runner: ${String(err)}`);
      });
    }
  }
}

function buildExplainSql(dialect: ExplainDialect, sql: string, analyzed: boolean): string {
  switch (dialect) {
    case 'postgres':
      return `EXPLAIN (${analyzed ? 'ANALYZE, ' : ''}FORMAT JSON) ${sql}`;
    case 'mysql':
      return `EXPLAIN ${analyzed ? 'ANALYZE ' : ''}FORMAT=JSON ${sql}`;
    case 'sqlite':
      return `EXPLAIN QUERY PLAN ${sql}`;
  }
}

/** Unwraps the driver's raw result into the canonical shape {@link parseExplainPlan} expects. */
function normalizeRaw(dialect: ExplainDialect, rows: unknown): unknown {
  const first = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
  switch (dialect) {
    case 'postgres': {
      const plan = first?.['QUERY PLAN'];
      return typeof plan === 'string' ? JSON.parse(plan) : plan;
    }
    case 'mysql': {
      const plan = first?.['EXPLAIN'];
      return typeof plan === 'string' ? JSON.parse(plan) : plan;
    }
    case 'sqlite':
      return rows;
  }
}
