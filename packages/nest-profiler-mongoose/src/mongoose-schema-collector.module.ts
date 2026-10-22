import { DynamicModule, Module } from '@nestjs/common';
import { buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import { ConfigurableModuleClass } from './mongoose-schema-collector.interface.js';
import type {
  MongooseSchemaCollectorModuleAsyncOptions,
  MongooseSchemaCollectorModuleOptions,
} from './mongoose-schema-collector.interface.js';
import { MongooseSchemaCollector } from './mongoose-schema.collector.js';

export { MONGOOSE_SCHEMA_COLLECTOR_OPTIONS } from './mongoose-schema-collector.interface.js';
export type {
  MongooseSchemaCollectorModuleOptions,
  MongooseSchemaCollectorModuleAsyncOptions,
} from './mongoose-schema-collector.interface.js';

// The collector resolves the (optionally named) connection lazily via ModuleRef at bootstrap.
const SHAPE: CollectorModuleShape = { providers: [MongooseSchemaCollector] };

@Module({})
export class MongooseSchemaCollectorModule extends ConfigurableModuleClass {
  static forRoot(options: MongooseSchemaCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, SHAPE);
  }

  static forRootAsync(options: MongooseSchemaCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, SHAPE);
  }
}
