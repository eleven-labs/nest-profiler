import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';
import type { CollectorModuleOptions } from '@eleven-labs/nest-profiler';

export interface MongooseSchemaCollectorModuleOptions extends CollectorModuleOptions {
  /**
   * Name of the Mongoose connection to introspect. Omit for the default connection. Set this in
   * apps that only register named connections (otherwise the default token would be missing).
   */
  connectionName?: string;
}

/** Async configuration for {@link MongooseSchemaCollectorModule.forRootAsync}. */
export type MongooseSchemaCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<MongooseSchemaCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
  };

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: MONGOOSE_SCHEMA_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<MongooseSchemaCollectorModuleOptions>()
    .setClassMethodName('forRoot')
    .build();
