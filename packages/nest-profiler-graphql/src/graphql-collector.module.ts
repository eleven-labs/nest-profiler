import { Module, Optional } from '@nestjs/common';
import type { DynamicModule, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ProfilerCoreService } from '@eleven-labs/nest-profiler';
import { GraphQLContextAdapter } from './adapters/graphql-context.adapter';
import { GraphqlRouteSource } from './graphql-route-source';
import { GRAPHQL_ENTRYPOINT_TYPE_DEF } from './graphql-entrypoint';

export interface GraphQLCollectorModuleOptions {
  /** Enable GraphQL profiling. Default: `true`. */
  enabled?: boolean;
}

@Module({})
export class GraphQLCollectorModule implements OnModuleInit {
  constructor(
    private readonly moduleRef: ModuleRef,
    // @Optional() so the module does not throw when forRoot({ enabled: false }) omits providers
    @Optional() private readonly adapter: GraphQLContextAdapter,
    @Optional() private readonly routeSource: GraphqlRouteSource,
  ) {}

  onModuleInit(): void {
    if (!this.adapter) return;
    try {
      // strict: false searches the global scope so ProfilerCoreService is found
      // even when ProfilerModule is imported as a sibling rather than a parent.
      const core = this.moduleRef.get<ProfilerCoreService>(ProfilerCoreService, { strict: false });
      core.registerContextAdapter(this.adapter);
      // Render GraphQL operations in their own list table and detail tab, and add
      // the "GraphQL" option to the list page's "Type" filter.
      core.registerEntrypointType(GRAPHQL_ENTRYPOINT_TYPE_DEF);
      // Contribute a GraphQL group to the Routes panel (rendered only if that package is installed).
      if (this.routeSource) core.registerRouteSource(this.routeSource);
    } catch {
      // ProfilerCoreService unavailable — profiler may not be configured.
    }
  }

  static forRoot(options: GraphQLCollectorModuleOptions = {}): DynamicModule {
    if (options.enabled === false) return { module: GraphQLCollectorModule };
    return {
      module: GraphQLCollectorModule,
      // The adapter registers itself with the core in onModuleInit via
      // registerContextAdapter() — that is the single, supported registration mechanism.
      providers: [GraphQLContextAdapter, GraphqlRouteSource],
    };
  }
}
