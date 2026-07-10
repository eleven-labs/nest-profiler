import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';

export interface MikroOrmSchemaCollectorModuleOptions {
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;
  /**
   * Name of the MikroORM context to introspect. Omit for the default. Set this in apps that
   * only register named contexts (otherwise the default `MikroORM` token would be missing).
   */
  connectionName?: string;
}

/** Async configuration for `MikroOrmSchemaCollectorModule.forRootAsync`. */
export type MikroOrmSchemaCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<MikroOrmSchemaCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
  };

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: MIKRO_ORM_SCHEMA_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<MikroOrmSchemaCollectorModuleOptions>()
    .setClassMethodName('forRoot')
    .build();
