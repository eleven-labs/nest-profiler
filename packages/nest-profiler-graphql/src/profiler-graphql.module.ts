import { Module, Optional } from '@nestjs/common';
import type { DynamicModule, OnModuleInit, Provider } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ProfilerCoreService, PROFILER_CONTEXT_ADAPTERS } from '@eleven-labs/nest-profiler';
import { GraphQLContextAdapter } from './adapters/graphql-context.adapter';

export interface ProfilerGraphQLModuleOptions {
  /** Enable GraphQL profiling. Default: `true`. */
  enabled?: boolean;
}

@Module({})
export class ProfilerGraphQLModule implements OnModuleInit {
  constructor(
    private readonly moduleRef: ModuleRef,
    // @Optional() so the module does not throw when forRoot({ enabled: false }) omits providers
    @Optional() private readonly adapter: GraphQLContextAdapter,
  ) {}

  onModuleInit(): void {
    if (!this.adapter) return;
    try {
      // strict: false searches the global scope so ProfilerCoreService is found
      // even when ProfilerModule is imported as a sibling rather than a parent.
      const core = this.moduleRef.get<ProfilerCoreService>(ProfilerCoreService, { strict: false });
      core.registerContextAdapter(this.adapter);
      // Surface GraphQL as a choice in the list page's "Type" filter.
      core.registerFilterOption('type', { value: 'graphql', label: 'GraphQL' });
    } catch {
      // ProfilerCoreService unavailable — profiler may not be configured.
    }
  }

  static forRoot(options: ProfilerGraphQLModuleOptions = {}): DynamicModule {
    if (options.enabled === false) return { module: ProfilerGraphQLModule };
    return {
      module: ProfilerGraphQLModule,
      providers: [
        GraphQLContextAdapter,
        // Also expose via the DI multi-token for consumers using direct injection
        {
          provide: PROFILER_CONTEXT_ADAPTERS,
          useExisting: GraphQLContextAdapter,
          multi: true,
        } as Provider,
      ],
    };
  }
}
