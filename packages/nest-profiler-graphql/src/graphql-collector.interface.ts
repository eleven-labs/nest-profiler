import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';
import type { ProfilerErrorOptions } from '@eleven-labs/nest-profiler';

export interface GraphQLCollectorModuleOptions {
  /** Enable GraphQL profiling. Default: `true`. */
  enabled?: boolean;

  /**
   * What counts as a **failed operation** — what earns the `error` tag and what the list's
   * `Errors` filter keeps.
   *
   * A GraphQL response is `200` even when the operation failed, so statuses say nothing here and
   * `extensions.code` takes their role. Default: only `INTERNAL_SERVER_ERROR`, plus any error
   * carrying no code — `BAD_REQUEST` (what the Nest Apollo driver emits for a rejected
   * mutation), `BAD_USER_INPUT`, `UNAUTHENTICATED` and `NOT_FOUND` are the schema answering
   * correctly, GraphQL's equivalent of a 4xx.
   *
   * ```ts
   * // Here, a failed login is an incident worth surfacing.
   * GraphQLCollectorModule.forRoot({
   *   error: { codes: ['INTERNAL_SERVER_ERROR', 'UNAUTHENTICATED'] },
   * });
   * ```
   */
  error?: ProfilerErrorOptions;
}

/** Async configuration for `GraphQLCollectorModule.forRootAsync`. */
export type GraphQLCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<GraphQLCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
  };

/** DI token holding the resolved {@link GraphQLCollectorModuleOptions}. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: GRAPHQL_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<GraphQLCollectorModuleOptions>()
    .setClassMethodName('forRoot')
    .build();
