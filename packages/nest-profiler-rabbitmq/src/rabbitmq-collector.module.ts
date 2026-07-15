import { DynamicModule, Inject, Module, OnModuleInit, Optional } from '@nestjs/common';
import { DiscoveryModule, ModuleRef } from '@nestjs/core';
import { ProfilerCoreService, buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import { RabbitMqContextAdapter } from './rabbitmq-context.adapter';
import { RabbitMqRouteSource } from './rabbitmq-route-source';
import {
  ConfigurableModuleClass,
  RABBITMQ_COLLECTOR_OPTIONS,
  type RabbitMqCollectorModuleOptions,
  type RabbitMqCollectorModuleAsyncOptions,
} from './rabbitmq-collector.interface';
import { buildRabbitMqEntrypointType } from './rabbitmq-entrypoint';

// The adapter registers itself with the core in onModuleInit via registerContextAdapter() —
// the single, supported registration mechanism. The route source self-registers at bootstrap and
// needs DiscoveryModule (DiscoveryService + MetadataScanner) to scan @RabbitSubscribe handlers.
const SHAPE: CollectorModuleShape = {
  imports: [DiscoveryModule],
  providers: [RabbitMqContextAdapter, RabbitMqRouteSource],
};

/**
 * Captures RabbitMQ messages consumed via `@RabbitSubscribe`
 * (`@golevelup/nestjs-rabbitmq`) and surfaces them in the web profiler.
 *
 * On init it registers a {@link RabbitMqContextAdapter} (so each consumed
 * message becomes its own profile) and the `rabbitmq` entrypoint type, which
 * contributes the dedicated **RabbitMQ** list table, the **Message** detail tab
 * and the `type` filter option — all in one call, without touching the core.
 */
@Module({})
export class RabbitMqCollectorModule extends ConfigurableModuleClass implements OnModuleInit {
  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional() private readonly adapter?: RabbitMqContextAdapter,
    @Optional()
    @Inject(RABBITMQ_COLLECTOR_OPTIONS)
    private readonly options: RabbitMqCollectorModuleOptions = {},
  ) {
    super();
  }

  onModuleInit(): void {
    if (!this.adapter) return;
    try {
      const core = this.moduleRef.get(ProfilerCoreService, { strict: false });
      core.registerContextAdapter(this.adapter);
      core.registerEntrypointType(buildRabbitMqEntrypointType(this.options.error));
    } catch {
      /* profiler core not available — no-op */
    }
  }

  static forRoot(options: RabbitMqCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, SHAPE);
  }

  /**
   * Async variant — resolve the options (e.g. `maskHeaders`, `captureBody`) from DI such as
   * `ConfigService`. Gating stays the host's job via `ConditionalModule.registerWhen`.
   */
  static forRootAsync(options: RabbitMqCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, SHAPE);
  }
}
