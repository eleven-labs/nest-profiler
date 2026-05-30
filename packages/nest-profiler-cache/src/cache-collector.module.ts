import { DynamicModule, Module } from '@nestjs/common';
import { CacheCollector } from './cache.collector';
import { CacheManagerPatch } from './cache-manager.patch';

export interface CacheCollectorModuleOptions {
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;
}

@Module({})
export class CacheCollectorModule {
  static forRoot(options: CacheCollectorModuleOptions = {}): DynamicModule {
    if (options.enabled === false) return { module: CacheCollectorModule };
    return {
      module: CacheCollectorModule,
      providers: [CacheManagerPatch, CacheCollector],
    };
  }
}
