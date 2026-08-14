import { DynamicModule, Module } from '@nestjs/common';
import { buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import { ConfigurableModuleClass } from './config-collector.interface';
import type {
  ConfigCollectorModuleAsyncOptions,
  ConfigCollectorModuleOptions,
} from './config-collector.interface';
import { ConfigCollector } from './config.collector';

export { CONFIG_COLLECTOR_OPTIONS } from './config-collector.interface';
export type {
  ConfigCollectorModuleOptions,
  ConfigCollectorModuleAsyncOptions,
} from './config-collector.interface';

const SHAPE: CollectorModuleShape = { providers: [ConfigCollector] };

@Module({})
export class ConfigCollectorModule extends ConfigurableModuleClass {
  static forRoot(options: ConfigCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, SHAPE);
  }

  /**
   * Async variant — resolve the options (e.g. `maskKeys`) from DI such as `ConfigService`.
   * Gating stays the host's job via `ConditionalModule.registerWhen`.
   */
  static forRootAsync(options: ConfigCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, SHAPE);
  }
}
