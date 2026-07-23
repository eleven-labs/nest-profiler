import { DynamicModule, Module } from '@nestjs/common';
import { buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import { ConfigurableModuleClass } from './typeorm-collector.interface';
import type {
  TypeOrmCollectorModuleAsyncOptions,
  TypeOrmCollectorModuleOptions,
} from './typeorm-collector.interface';
import { TypeOrmCollector } from './typeorm.collector';
import { TypeOrmDriverPatch } from './typeorm-driver.patch';
import { TypeOrmExplainRunner } from './typeorm-explain.runner';

export { TYPEORM_COLLECTOR_OPTIONS } from './typeorm-collector.interface';
export type {
  TypeOrmCollectorModuleOptions,
  TypeOrmCollectorModuleAsyncOptions,
} from './typeorm-collector.interface';

// The patch resolves the (optionally named) DataSource + ClsService lazily via ModuleRef.
// The explain runner registers itself with the core ExplainRunnerRegistry on init.
const SHAPE: CollectorModuleShape = {
  providers: [TypeOrmDriverPatch, TypeOrmCollector, TypeOrmExplainRunner],
};

@Module({})
export class TypeOrmCollectorModule extends ConfigurableModuleClass {
  static forRoot(options: TypeOrmCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, SHAPE);
  }

  /**
   * Async variant — resolve the options (e.g. `slowThreshold`) from DI such as
   * `ConfigService`. Gating stays the host's job via `ConditionalModule.registerWhen`.
   */
  static forRootAsync(options: TypeOrmCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, SHAPE);
  }
}
