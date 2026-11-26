import { Logger, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConditionalModule, ConfigModule, ConfigService } from '@nestjs/config';
import { PubSub } from '@google-cloud/pubsub';
import { PubSubPublishCollectorModule } from '@eleven-labs/nest-profiler-pubsub';
import { isProfilerEnabled } from '../../../config/profiler.config.js';
import pubsubConfig from '../../../config/pubsub.config.js';
import { EventPublisher } from '../../domain/event-publisher.js';
import { PubSubEventPublisher } from './pubsub.publisher.js';
import { PRODUCT_EVENTS_TOPIC } from './pubsub.constants.js';

/** gRPC status of a `createTopic` on a topic that already exists. */
const ALREADY_EXISTS = 6;

/**
 * Google Cloud Pub/Sub adapter for the notifications context, used by the catalog. Selected when
 * `FEATURE_PUBSUB=true`, in place of the in-process event emitter: `product.created` then leaves the
 * process as a Pub/Sub message, listed in the Pub/Sub panel of the request that published it.
 *
 * Talks to the emulator (`docker compose up -d pubsub`) and creates its topic at startup, which a
 * real project would provision with its infrastructure instead.
 */
@Module({
  imports: [
    ConfigModule.forFeature(pubsubConfig),
    // Lists every message published during a profiled request in a Pub/Sub panel.
    ConditionalModule.registerWhen(PubSubPublishCollectorModule.forRoot(), isProfilerEnabled),
  ],
  providers: [
    {
      provide: PubSub,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new PubSub({
          projectId: config.get<string>('pubsub.projectId')!,
          apiEndpoint: config.get<string>('pubsub.apiEndpoint')!,
        }),
    },
    { provide: EventPublisher, useClass: PubSubEventPublisher },
  ],
  exports: [EventPublisher],
})
export class NotificationsPubSubModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationsPubSubModule.name);

  constructor(private readonly pubSub: PubSub) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.pubSub.createTopic(PRODUCT_EVENTS_TOPIC);
      this.logger.log(`Pub/Sub topic "${PRODUCT_EVENTS_TOPIC}" created`);
    } catch (error) {
      if ((error as { code?: number }).code !== ALREADY_EXISTS) throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pubSub.close();
  }
}
