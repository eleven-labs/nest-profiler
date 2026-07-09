import { ConfigurableModuleBuilder, DynamicModule, Module } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import { RoutesCollector } from './routes.collector';
import { HttpRouteSource } from './http-route-source';

/** Options for {@link RoutesCollectorModule}. */
export interface RoutesCollectorModuleOptions {
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;
}

/** Async configuration for {@link RoutesCollectorModule.forRootAsync}. */
export type RoutesCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<RoutesCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
  };

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: ROUTES_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<RoutesCollectorModuleOptions>()
    .setClassMethodName('forRoot')
    .build();

// DiscoveryModule provides DiscoveryService + MetadataScanner, which HttpRouteSource uses to walk
// the controllers once at bootstrap.
const SHAPE: CollectorModuleShape = {
  imports: [DiscoveryModule],
  providers: [RoutesCollector, HttpRouteSource],
};

/**
 * Opt-in module contributing the global **Routes** panel to the profiler home page — a
 * Symfony-Routing-style view of every registered route. It ships a built-in REST route source;
 * other transport packages (`@eleven-labs/nest-profiler-graphql`, `-rabbitmq`, `-commander`)
 * contribute their own routes by registering a `ProfilerRouteSource` with the core.
 */
@Module({})
export class RoutesCollectorModule extends ConfigurableModuleClass {
  static forRoot(options: RoutesCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, SHAPE);
  }

  /** Async variant — gating stays the host's job via `ConditionalModule.registerWhen`. */
  static forRootAsync(options: RoutesCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, SHAPE);
  }
}
