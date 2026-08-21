import { DynamicModule, Module } from '@nestjs/common';
import { buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import { ConfigurableModuleClass } from './rabbitmq-publish-collector.interface';
import type {
  RabbitMqPublishCollectorModuleAsyncOptions,
  RabbitMqPublishCollectorModuleOptions,
} from './rabbitmq-publish-collector.interface';
import { RabbitMqPublishCollector } from './rabbitmq-publish.collector';
import { RabbitMqPublishPatch } from './rabbitmq-publish.patch';

export { RABBITMQ_PUBLISH_COLLECTOR_OPTIONS } from './rabbitmq-publish-collector.interface';
export type {
  RabbitMqPublishCollectorModuleOptions,
  RabbitMqPublishCollectorModuleAsyncOptions,
} from './rabbitmq-publish-collector.interface';

// The patch resolves ClsService lazily via ModuleRef, so it needs no imports of its own.
const SHAPE: CollectorModuleShape = { providers: [RabbitMqPublishPatch, RabbitMqPublishCollector] };

/**
 * Captures the RabbitMQ messages the application **publishes** through
 * `AmqpConnection.publish` (`@golevelup/nestjs-rabbitmq`) and lists them in a dedicated
 * **RabbitMQ** panel: exchange, routing key, headers, payload, duration and outcome, with the
 * profiler's slow / N+1 / error tags.
 *
 * Independent of `RabbitMqCollectorModule`, which covers the other direction (a consumed
 * message becoming its own profile). Register this one in a publish-only application, the
 * other in a consumer, or both when the application does both — the panel then also lists the
 * messages a consumer republishes.
 */
@Module({})
export class RabbitMqPublishCollectorModule extends ConfigurableModuleClass {
  static forRoot(options: RabbitMqPublishCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, SHAPE);
  }

  /**
   * Async variant — resolve the options (e.g. `maskHeaders`, `slowThreshold`) from DI such as
   * `ConfigService`. Gating stays the host's job via `ConditionalModule.registerWhen`.
   */
  static forRootAsync(options: RabbitMqPublishCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, SHAPE);
  }
}
