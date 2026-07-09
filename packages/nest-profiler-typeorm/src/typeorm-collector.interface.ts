import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';

// SQL query types are shared across ORM collectors and live in the core package.
// Re-exported here to keep this package's public API stable.
export type { QueryEntry, QueryType } from '@eleven-labs/nest-profiler';
export { detectQueryType } from '@eleven-labs/nest-profiler';

export interface TypeOrmCollectorModuleOptions {
  /** Queries at or above this duration (ms) are tagged `slow`. Default: 100 */
  slowThreshold?: number;
  /**
   * Identical queries (same parameter-free fingerprint) repeated at least this many
   * times in one request are tagged `n-plus-one` — the N+1 signal. Default: 2
   */
  nPlusOneThreshold?: number;
  /** A request running at least this many queries is tagged `chatty`. Default: 20 */
  chattyThreshold?: number;
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;
  /**
   * Name of the TypeORM DataSource to instrument. Omit for the default connection. Set this in
   * apps that only register named DataSources (otherwise the default token would be missing).
   */
  connectionName?: string;
}

/** Async configuration for {@link TypeOrmCollectorModule.forRootAsync}. */
export type TypeOrmCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<TypeOrmCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
  };

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: TYPEORM_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<TypeOrmCollectorModuleOptions>()
    .setClassMethodName('forRoot')
    .build();
