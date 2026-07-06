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

export const MIKRO_ORM_COLLECTOR_OPTIONS = Symbol('MIKRO_ORM_COLLECTOR_OPTIONS');
