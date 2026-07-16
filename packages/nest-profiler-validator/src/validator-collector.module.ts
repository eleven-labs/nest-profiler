import { ConfigurableModuleBuilder, DynamicModule, Module } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';
import { buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import { ValidatorCollector } from './validator.collector';

/** Options for {@link ValidatorCollectorModule}. */
export interface ValidatorCollectorModuleOptions {
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host decides per environment). */
  enabled?: boolean;
}

/** Async configuration for {@link ValidatorCollectorModule.forRootAsync}. */
export type ValidatorCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<ValidatorCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
  };

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: VALIDATOR_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<ValidatorCollectorModuleOptions>()
    .setClassMethodName('forRoot')
    .build();

const SHAPE: CollectorModuleShape = {
  providers: [ValidatorCollector],
};

/**
 * Opt-in module contributing the **Validator** panel (valid/invalid DTO validations, per-property
 * violations). It registers only the panel — the validation pipe is app-owned via
 * `createProfilerValidationPipe(...)` — so it gates like every other collector.
 */
@Module({})
export class ValidatorCollectorModule extends ConfigurableModuleClass {
  static forRoot(options: ValidatorCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, SHAPE);
  }

  /** Async variant — gating stays the host's job via `ConditionalModule.registerWhen`. */
  static forRootAsync(options: ValidatorCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, SHAPE);
  }
}
