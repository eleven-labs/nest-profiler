import { DynamicModule, Module } from '@nestjs/common';
import { MikroOrmCollector } from './mikro-orm.collector.js';
import {
  MIKRO_ORM_COLLECTOR_OPTIONS,
  type MikroOrmCollectorModuleOptions,
} from './mikro-orm-collector.interface.js';
import { MikroOrmLoggerPatch } from './mikro-orm-logger.patch.js';

@Module({})
export class MikroOrmCollectorModule {
  static forRoot(options: MikroOrmCollectorModuleOptions = {}): DynamicModule {
    if (options.enabled === false) return { module: MikroOrmCollectorModule };
    return {
      module: MikroOrmCollectorModule,
      providers: [
        { provide: MIKRO_ORM_COLLECTOR_OPTIONS, useValue: options },
        // The patch resolves the (optionally named) MikroORM context + ClsService lazily via ModuleRef.
        MikroOrmLoggerPatch,
        MikroOrmCollector,
      ],
    };
  }
}
