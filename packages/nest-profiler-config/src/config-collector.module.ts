import { ConfigurableModuleBuilder, DynamicModule, Module } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';
import { buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import { ConfigCollector } from './config.collector';

export interface ConfigCollectorModuleOptions {
  maskKeys?: string[];
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;
}

/** Async configuration for {@link ConfigCollectorModule.forRootAsync}. */
export type ConfigCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<ConfigCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
  };

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: CONFIG_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<ConfigCollectorModuleOptions>()
    .setClassMethodName('forRoot')
    .build();

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
