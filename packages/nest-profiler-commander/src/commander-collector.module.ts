import { DynamicModule, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { COMMANDER_COLLECTOR_OPTIONS } from './commander-collector.interface';
import { CommandProfiler } from './command-profiler.service';
import { CommandProfilerExplorer } from './command-profiler.explorer';

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
      providers: [
        { provide: COMMANDER_COLLECTOR_OPTIONS, useValue: options },
        CommandProfiler,
        CommandProfilerExplorer,
      ],
    };
  }
}
