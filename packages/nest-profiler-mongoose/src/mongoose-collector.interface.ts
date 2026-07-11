import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';
import type { ProfilerTag, TagSeverity } from '@eleven-labs/nest-profiler';

export interface MongooseQueryEntry {
  collection: string;
  operation: string;
  filter?: Record<string, unknown>;
  /** Aggregation pipeline stages, captured for `aggregate` operations. */
  pipeline?: unknown[];
  duration: number;
  startedAt: number;
  /** Documents affected (writes) or returned (reads) — the MongoDB row-count analog. */
  count?: number;
  /** Connection endpoint, host:port only (no credentials). e.g. `"localhost:27017"`. */
  connection?: string;
  /** Target database name. */
  database?: string;
  error?: string;
  /** True for streaming reads (`Query.cursor()` / `Aggregate.cursor()`). */
  streaming?: boolean;
  /** Runnable mongosh command, precomputed by the collector for the UI copy button. */
  command?: string;
  /**
   * Value-free key (collection + operation + filter/pipeline shape) used by the
   * performance-rule engine to group repeated operations (the N+1 signal).
   */
  fingerprint?: string;
  /** Performance tags applied by the rule engine (slow, N+1, error…). */
  tags?: ProfilerTag[];
}

export const MONGOOSE_QUERIES_KEY = '__mongoose_queries';

export interface MongooseCollectorModuleOptions {
  /** Operations at or above this duration (ms) are tagged `slow`. Default: 100 */
  slowThreshold?: number;
  /**
   * Identical operations (same collection + operation + filter shape) repeated at
   * least this many times in one request are tagged `n-plus-one` — the N+1 signal.
   * Default: 2
   */
  nPlusOneThreshold?: number;
  /** A request running at least this many operations is tagged `chatty`. Default: 20 */
  chattyThreshold?: number;
  /** Severity of the `slow` tag. Default: `warning`. */
  slowSeverity?: TagSeverity;
  /** Severity of the `n-plus-one` tag. Default: `danger`. */
  nPlusOneSeverity?: TagSeverity;
  /** Severity of the `chatty` tag. Default: `warning`. */
  chattySeverity?: TagSeverity;
  /** Severity of the `zero-rows` tag (a write affecting 0 documents). Default: `warning`. */
  zeroRowsSeverity?: TagSeverity;
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;
  /**
   * Name of the Mongoose connection to instrument. Omit for the default connection. Set this in
   * apps that only register named connections (otherwise the default token would be missing).
   */
  connectionName?: string;
}

/** Async configuration for {@link MongooseCollectorModule.forRootAsync}. */
export type MongooseCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<MongooseCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
  };

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: MONGOOSE_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<MongooseCollectorModuleOptions>()
    .setClassMethodName('forRoot')
    .build();
