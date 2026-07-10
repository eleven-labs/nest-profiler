import { DynamicModule, Module } from '@nestjs/common';
import { buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import { ConfigurableModuleClass } from './typeorm-schema-collector.interface';
import type {
  TypeOrmSchemaCollectorModuleAsyncOptions,
  TypeOrmSchemaCollectorModuleOptions,
} from './typeorm-schema-collector.interface';
import { TypeOrmSchemaCollector } from './typeorm-schema.collector';

export { TYPEORM_SCHEMA_COLLECTOR_OPTIONS } from './typeorm-schema-collector.interface';
export type {
  TypeOrmSchemaCollectorModuleOptions,
  TypeOrmSchemaCollectorModuleAsyncOptions,
} from './typeorm-schema-collector.interface';

// The collector resolves the (optionally named) DataSource lazily via ModuleRef at bootstrap.
const SHAPE: CollectorModuleShape = { providers: [TypeOrmSchemaCollector] };

@Module({})
export class TypeOrmSchemaCollectorModule extends ConfigurableModuleClass {
  static forRoot(options: TypeOrmSchemaCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, SHAPE);
  }

  static forRootAsync(options: TypeOrmSchemaCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, SHAPE);
  }
}
