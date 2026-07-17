import { Inject, Injectable, Logger, Optional, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { MikroORM } from '@mikro-orm/core';
import { getMikroORMToken } from '@mikro-orm/nestjs';
import type { ExplainDialect, ExplainRawResult, ExplainRunner } from '@eleven-labs/nest-profiler';
import { ExplainRunnerRegistry, detectQueryType, tryResolve } from '@eleven-labs/nest-profiler';
import { MIKRO_ORM_COLLECTOR_OPTIONS } from './mikro-orm-collector.interface.js';
import type { MikroOrmCollectorModuleOptions } from './mikro-orm-collector.interface.js';

/** Maps a MikroORM platform (by class name) to a supported EXPLAIN dialect (or `null`). */
function toDialect(platformName: string | undefined): ExplainDialect | null {
  if (!platformName) return null;
  if (/postgre/i.test(platformName)) return 'postgres';
  if (/maria|mysql/i.test(platformName)) return 'mysql';
  if (/sqlite|libsql/i.test(platformName)) return 'sqlite';
  return null;
}

/** The subset of the MikroORM connection surface the runner relies on. */
interface SqlConnection {
  execute(sql: string, params?: unknown[], method?: 'all' | 'get' | 'run'): Promise<unknown>;
}

/**
 * Runs `EXPLAIN` for the MikroORM collector's queries, on demand, over the ORM connection.
 * Registered with the core {@link ExplainRunnerRegistry} on init — only when `explain.enabled`
 * is not `false` and the platform dialect is supported — which is what makes the SQL panel's
 * "Explain" action appear. Nothing runs until a user clicks it, so the profiled request is
 * never slowed. `EXPLAIN` alone does not execute the statement; `ANALYZE` (opt-in) is
 * restricted to `SELECT`.
 */
@Injectable()
export class MikroOrmExplainRunner implements ExplainRunner, OnModuleInit {
  readonly collectorName = 'mikro-orm';
  private readonly logger = new Logger(MikroOrmExplainRunner.name);
  private orm: MikroORM | undefined;
  private dialect: ExplainDialect | null = null;

  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(MIKRO_ORM_COLLECTOR_OPTIONS)
    private readonly options: MikroOrmCollectorModuleOptions = {},
  ) {}

  onModuleInit(): void {
    if (this.options.explain?.enabled === false) return;

    // Resolve the core registry lazily (like the logger patch resolves ClsService): it may be
    // out of the collector's injector scope, or absent entirely under the no-op core — no-op then.
    const registry = tryResolve<ExplainRunnerRegistry>(this.moduleRef, ExplainRunnerRegistry);
    if (!registry) return;

    const orm = tryResolve<MikroORM>(
      this.moduleRef,
      this.options.connectionName ? getMikroORMToken(this.options.connectionName) : MikroORM,
    );
    if (!orm) return;

    const platformName = safePlatformName(orm);
    const dialect = toDialect(platformName);
    if (!dialect) return; // Unsupported platform — no "Explain" action for this collector.

    this.orm = orm;
    this.dialect = dialect;
    registry.register(this);
  }

  async explain(
    sql: string,
    parameters: readonly unknown[] | undefined,
  ): Promise<ExplainRawResult> {
    const orm = this.orm;
    const dialect = this.dialect;
    if (!orm || !dialect) throw new Error('EXPLAIN is not available for this connection.');

    // ANALYZE executes the query — restrict it to SELECT so writes are never re-run.
    const analyzed =
      this.options.explain?.analyze === true &&
      detectQueryType(sql) === 'SELECT' &&
      dialect !== 'sqlite';

    const connection = orm.em.getConnection() as unknown as SqlConnection;
    const explainSql = buildExplainSql(dialect, sql, analyzed);
    const rows = await connection.execute(explainSql, parameters ? [...parameters] : [], 'all');
    return { dialect, analyzed, raw: normalizeRaw(dialect, rows) };
  }
}

function safePlatformName(orm: MikroORM): string | undefined {
  try {
    return orm.em.getPlatform().constructor.name;
  } catch {
    return undefined;
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

/** Unwraps the driver's raw result into the canonical shape `parseExplainPlan` expects. */
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
