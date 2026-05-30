import { DynamicModule, Module } from '@nestjs/common';
import { ConfigCollector } from './config.collector';

export interface ConfigCollectorModuleOptions {
  maskKeys?: string[];
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;
}

export const CONFIG_COLLECTOR_OPTIONS = Symbol('CONFIG_COLLECTOR_OPTIONS');

@Module({})
export class ConfigCollectorModule {
  static forRoot(options: ConfigCollectorModuleOptions = {}): DynamicModule {
    if (options.enabled === false) return { module: ConfigCollectorModule };
    return {
      module: ConfigCollectorModule,
      providers: [{ provide: CONFIG_COLLECTOR_OPTIONS, useValue: options }, ConfigCollector],
    };
  }
}
