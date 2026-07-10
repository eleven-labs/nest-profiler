import { DynamicModule, Module } from '@nestjs/common';
import { buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import { MikroOrmSchemaCollector } from './mikro-orm-schema.collector.js';
import {
  ConfigurableModuleClass,
  type MikroOrmSchemaCollectorModuleOptions,
  type MikroOrmSchemaCollectorModuleAsyncOptions,
} from './mikro-orm-schema-collector.interface.js';

// The collector resolves the (optionally named) MikroORM context lazily via ModuleRef at bootstrap.
const SHAPE: CollectorModuleShape = { providers: [MikroOrmSchemaCollector] };

@Module({})
export class MikroOrmSchemaCollectorModule extends ConfigurableModuleClass {
  static forRoot(options: MikroOrmSchemaCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, SHAPE);
  }

  static forRootAsync(options: MikroOrmSchemaCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, SHAPE);
  }
}
