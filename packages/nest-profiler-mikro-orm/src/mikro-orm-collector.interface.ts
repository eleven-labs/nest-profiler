import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';
import type { ExplainOptions, TagSeverity } from '@eleven-labs/nest-profiler';

// SQL query types are shared across ORM collectors and live in the core package.
// Re-exported here to keep this package's public API self-contained.
export type { QueryEntry, QueryType } from '@eleven-labs/nest-profiler';
export { detectQueryType } from '@eleven-labs/nest-profiler';

export interface MikroOrmCollectorModuleOptions {
  /** Queries at or above this duration (ms) are tagged `slow`. Default: 100 */
  slowThreshold?: number;
  /**
   * Identical queries (same parameter-free fingerprint) repeated at least this many
   * times in one request are tagged `n-plus-one` — the N+1 signal. Default: 2
   */
  nPlusOneThreshold?: number;
  /** A request running at least this many queries is tagged `chatty`. Default: 20 */
  chattyThreshold?: number;
  /** Severity of the `slow` tag. Default: `warning`. */
  slowSeverity?: TagSeverity;
  /** Severity of the `n-plus-one` tag. Default: `danger`. */
  nPlusOneSeverity?: TagSeverity;
  /** Severity of the `chatty` tag. Default: `warning`. */
  chattySeverity?: TagSeverity;
  /** Severity of the `zero-rows` tag (a write affecting 0 rows). Default: `warning`. */
  zeroRowsSeverity?: TagSeverity;
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;
  /**
   * On-demand SQL `EXPLAIN` for captured queries: adds an "Explain" action in the SQL panel
   * that runs `EXPLAIN` over the MikroORM connection on click (never during the profiled
   * request). Supported dialects: PostgreSQL, MySQL/MariaDB, SQLite. Default: `{ enabled: true }`;
   * set `enabled: false` to hide the action, or `analyze: true` for `EXPLAIN ANALYZE` (SELECT-only).
   */
  explain?: ExplainOptions;
  /**
   * Name of the MikroORM context to instrument. Omit for the default. Set this in apps that
   * only register named contexts (otherwise the default `MikroORM` token would be missing).
   */
  connectionName?: string;
}

/** Async configuration for `MikroOrmCollectorModule.forRootAsync`. */
export type MikroOrmCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<MikroOrmCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
  };

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: MIKRO_ORM_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<MikroOrmCollectorModuleOptions>()
    .setClassMethodName('forRoot')
    .build();
