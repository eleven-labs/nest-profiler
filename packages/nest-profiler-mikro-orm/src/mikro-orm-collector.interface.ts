import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';

// SQL query types are shared across ORM collectors and live in the core package.
// Re-exported here to keep this package's public API self-contained.
export type { QueryEntry, QueryType } from '@eleven-labs/nest-profiler';
export { detectQueryType } from '@eleven-labs/nest-profiler';

export interface MikroOrmCollectorModuleOptions {
  /** Queries exceeding this duration (ms) are marked as slow. Default: 100 */
  slowQueryThreshold?: number;
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;
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
