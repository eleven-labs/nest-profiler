import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';

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

/**
 * The options token lives here, next to the builder that creates it, and never in the module
 * file: the module imports the collector, which injects this token — importing it from the
 * module would close that cycle and leave the token undefined when the collector's decorators
 * run, silently degrading `@Inject(...)` to the `@Optional()` default.
 */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: CONFIG_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<ConfigCollectorModuleOptions>()
    .setClassMethodName('forRoot')
    .build();
