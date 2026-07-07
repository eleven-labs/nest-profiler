import { DynamicModule, Module } from '@nestjs/common';
import { buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import { MikroOrmCollector } from './mikro-orm.collector.js';
import {
  ConfigurableModuleClass,
  type MikroOrmCollectorModuleOptions,
  type MikroOrmCollectorModuleAsyncOptions,
} from './mikro-orm-collector.interface.js';
import { MikroOrmLoggerPatch } from './mikro-orm-logger.patch.js';

// The patch resolves the (optionally named) MikroORM context + ClsService lazily via ModuleRef.
const SHAPE: CollectorModuleShape = { providers: [MikroOrmLoggerPatch, MikroOrmCollector] };

@Module({})
export class MikroOrmCollectorModule extends ConfigurableModuleClass {
  static forRoot(options: MikroOrmCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, SHAPE);
  }

  /**
   * Async variant — resolve the options (e.g. `slowQueryThreshold`) from DI such as
   * `ConfigService`. Gating stays the host's job via `ConditionalModule.registerWhen`.
   */
  static forRootAsync(options: MikroOrmCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, SHAPE);
  }
}
