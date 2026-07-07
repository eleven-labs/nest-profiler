import { ConfigurableModuleBuilder, DynamicModule, Module } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';
import { buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import { TypeOrmCollector } from './typeorm.collector';
import { TypeOrmDriverPatch } from './typeorm-driver.patch';

export interface TypeOrmCollectorModuleOptions {
  /** Queries exceeding this duration (ms) are marked as slow. Default: 100 */
  slowQueryThreshold?: number;
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;
  /**
   * Name of the TypeORM DataSource to instrument. Omit for the default connection. Set this in
   * apps that only register named DataSources (otherwise the default token would be missing).
   */
  connectionName?: string;
}

/** Async configuration for {@link TypeOrmCollectorModule.forRootAsync}. */
export type TypeOrmCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<TypeOrmCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
  };

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: TYPEORM_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<TypeOrmCollectorModuleOptions>()
    .setClassMethodName('forRoot')
    .build();

// The patch resolves the (optionally named) DataSource + ClsService lazily via ModuleRef.
const SHAPE: CollectorModuleShape = { providers: [TypeOrmDriverPatch, TypeOrmCollector] };

@Module({})
export class TypeOrmCollectorModule extends ConfigurableModuleClass {
  static forRoot(options: TypeOrmCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, SHAPE);
  }

  /**
   * Async variant — resolve the options (e.g. `slowQueryThreshold`) from DI such as
   * `ConfigService`. Gating stays the host's job via `ConditionalModule.registerWhen`.
   */
  static forRootAsync(options: TypeOrmCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, SHAPE);
  }
}
