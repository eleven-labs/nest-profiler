import { DynamicModule, Module } from '@nestjs/common';
import { buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import { ConfigurableModuleClass } from './pubsub-publish-collector.interface.js';
import type {
  PubSubPublishCollectorModuleAsyncOptions,
  PubSubPublishCollectorModuleOptions,
} from './pubsub-publish-collector.interface.js';
import { PubSubPublishCollector } from './pubsub-publish.collector.js';
import { PubSubPublishPatch } from './pubsub-publish.patch.js';

export { PUBSUB_PUBLISH_COLLECTOR_OPTIONS } from './pubsub-publish-collector.interface.js';
export type {
  PubSubPublishCollectorModuleOptions,
  PubSubPublishCollectorModuleAsyncOptions,
} from './pubsub-publish-collector.interface.js';

// The patch resolves ClsService lazily via ModuleRef, so it needs no imports of its own.
const SHAPE: CollectorModuleShape = { providers: [PubSubPublishPatch, PubSubPublishCollector] };

/**
 * Captures the Google Cloud Pub/Sub messages the application **publishes** through
 * `Topic.publishMessage` (`@google-cloud/pubsub`, which `topic.publish()` and
 * `topic.publishJSON()` route through) and lists them in a dedicated **Pub/Sub** panel: topic,
 * attributes, ordering key, payload, message id, duration and outcome, with the profiler's
 * slow / N+1 / error tags.
 */
@Module({})
export class PubSubPublishCollectorModule extends ConfigurableModuleClass {
  static forRoot(options: PubSubPublishCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, SHAPE);
  }

  /**
   * Async variant — resolve the options (e.g. `maskAttributes`, `slowThreshold`) from DI such as
   * `ConfigService`. Gating stays the host's job via `ConditionalModule.registerWhen`.
   */
  static forRootAsync(options: PubSubPublishCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, SHAPE);
  }
}
