import { DynamicModule, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { CommandProfiler } from './command-profiler.service';
import { CommandProfilerExplorer } from './command-profiler.explorer';
import { CommanderRouteSource } from './commander-route-source';

export interface CommanderCollectorModuleOptions {
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;
}

// `CommandProfiler` registers the `command` entrypoint type in its `onModuleInit`
// (it already injects `ProfilerCoreService`), so the module stays a thin factory.
@Module({})
export class CommanderCollectorModule {
  static forRoot(options: CommanderCollectorModuleOptions = {}): DynamicModule {
    if (options.enabled === false) return { module: CommanderCollectorModule };
    return {
      module: CommanderCollectorModule,
      imports: [DiscoveryModule],
      providers: [CommandProfiler, CommandProfilerExplorer, CommanderRouteSource],
    };
  }
}
