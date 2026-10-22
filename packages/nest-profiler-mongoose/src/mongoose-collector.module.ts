import { DynamicModule, Module } from '@nestjs/common';
import { buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import { ConfigurableModuleClass } from './mongoose-collector.interface.js';
import type {
  MongooseCollectorModuleAsyncOptions,
  MongooseCollectorModuleOptions,
} from './mongoose-collector.interface.js';
import { MongooseCollector } from './mongoose.collector.js';
import { MongooseConnectionPatch } from './mongoose-connection.patch.js';

export { MONGOOSE_COLLECTOR_OPTIONS } from './mongoose-collector.interface.js';
export type {
  MongooseCollectorModuleOptions,
  MongooseCollectorModuleAsyncOptions,
} from './mongoose-collector.interface.js';

// The patch resolves the (optionally named) connection + ClsService lazily via ModuleRef.
const SHAPE: CollectorModuleShape = { providers: [MongooseConnectionPatch, MongooseCollector] };

@Module({})
export class MongooseCollectorModule extends ConfigurableModuleClass {
  static forRoot(options: MongooseCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, SHAPE);
  }

  /**
   * Async variant — resolve the options (e.g. `slowThreshold`) from DI such as
   * `ConfigService`. Gating stays the host's job via `ConditionalModule.registerWhen`.
   */
  static forRootAsync(options: MongooseCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, SHAPE);
  }
}
