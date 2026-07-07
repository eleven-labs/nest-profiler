import { ConfigurableModuleBuilder, DynamicModule, Module } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';
import { buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import { MongooseCollector } from './mongoose.collector';
import { MongooseConnectionPatch } from './mongoose-connection.patch';

export interface MongooseCollectorModuleOptions {
  /** Queries exceeding this duration (ms) are marked as slow. Default: 100 */
  slowQueryThreshold?: number;
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;
  /**
   * Name of the Mongoose connection to instrument. Omit for the default connection. Set this in
   * apps that only register named connections (otherwise the default token would be missing).
   */
  connectionName?: string;
}

/** Async configuration for {@link MongooseCollectorModule.forRootAsync}. */
export type MongooseCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<MongooseCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
  };

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: MONGOOSE_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<MongooseCollectorModuleOptions>()
    .setClassMethodName('forRoot')
    .build();

// The patch resolves the (optionally named) connection + ClsService lazily via ModuleRef.
const SHAPE: CollectorModuleShape = { providers: [MongooseConnectionPatch, MongooseCollector] };

@Module({})
export class MongooseCollectorModule extends ConfigurableModuleClass {
  static forRoot(options: MongooseCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, SHAPE);
  }

  /**
   * Async variant — resolve the options (e.g. `slowQueryThreshold`) from DI such as
   * `ConfigService`. Gating stays the host's job via `ConditionalModule.registerWhen`.
   */
  static forRootAsync(options: MongooseCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, SHAPE);
  }
}
