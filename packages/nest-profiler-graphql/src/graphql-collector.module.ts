import { Inject, Module, Optional } from '@nestjs/common';
import type { DynamicModule, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ProfilerCoreService, buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import { GraphQLContextAdapter } from './adapters/graphql-context.adapter';
import { GraphqlRouteSource } from './graphql-route-source';
import { buildGraphqlEntrypointType } from './graphql-entrypoint';
import { GraphqlFieldTraceContributor } from './tracing/graphql-field-trace.contributor';
import {
  ConfigurableModuleClass,
  GRAPHQL_COLLECTOR_OPTIONS,
  type GraphQLCollectorModuleOptions,
  type GraphQLCollectorModuleAsyncOptions,
} from './graphql-collector.interface';

export type {
  GraphQLCollectorModuleOptions,
  GraphQLCollectorModuleAsyncOptions,
} from './graphql-collector.interface';

// The adapter registers itself with the core in onModuleInit via registerContextAdapter() —
// the single, supported registration mechanism.
const SHAPE: CollectorModuleShape = {
  providers: [GraphQLContextAdapter, GraphqlRouteSource],
};

@Module({})
export class GraphQLCollectorModule extends ConfigurableModuleClass implements OnModuleInit {
  constructor(
    private readonly moduleRef: ModuleRef,
    // @Optional() so the module does not throw when forRoot({ enabled: false }) omits providers
    @Optional() private readonly adapter?: GraphQLContextAdapter,
    @Optional() private readonly routeSource?: GraphqlRouteSource,
    @Optional()
    @Inject(GRAPHQL_COLLECTOR_OPTIONS)
    private readonly options: GraphQLCollectorModuleOptions = {},
  ) {
    super();
  }

  onModuleInit(): void {
    if (!this.adapter) return;
    try {
      // strict: false searches the global scope so ProfilerCoreService is found
      // even when ProfilerModule is imported as a sibling rather than a parent.
      const core = this.moduleRef.get<ProfilerCoreService>(ProfilerCoreService, { strict: false });
      core.registerContextAdapter(this.adapter);
      // Render GraphQL operations in their own list table and detail tab, and add
      // the "GraphQL" option to the list page's "Type" filter.
      core.registerEntrypointType(buildGraphqlEntrypointType(this.options.error));
      // Drain the per-field spans captured by the field middleware into the unified trace.
      core.registerTraceContributor(new GraphqlFieldTraceContributor());
      // Contribute a GraphQL group to the Routes panel (rendered only if that package is installed).
      if (this.routeSource) core.registerRouteSource(this.routeSource);
    } catch {
      // ProfilerCoreService unavailable — profiler may not be configured.
    }
  }

  static forRoot(options: GraphQLCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, SHAPE);
  }

  /**
   * Async variant — resolve the options (e.g. which `error` codes count as a failure) from DI
   * such as `ConfigService`. Gating stays the host's job via `ConditionalModule.registerWhen`.
   */
  static forRootAsync(options: GraphQLCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, SHAPE);
  }
}
