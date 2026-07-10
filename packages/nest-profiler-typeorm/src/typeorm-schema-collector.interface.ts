import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';

export interface TypeOrmSchemaCollectorModuleOptions {
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;
  /**
   * Name of the TypeORM DataSource to introspect. Omit for the default connection. Set this in
   * apps that only register named DataSources (otherwise the default token would be missing).
   */
  connectionName?: string;
}

/** Async configuration for {@link TypeOrmSchemaCollectorModule.forRootAsync}. */
export type TypeOrmSchemaCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<TypeOrmSchemaCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
  };

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: TYPEORM_SCHEMA_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<TypeOrmSchemaCollectorModuleOptions>()
    .setClassMethodName('forRoot')
    .build();
