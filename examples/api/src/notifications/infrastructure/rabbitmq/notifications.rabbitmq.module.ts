import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule, ConfigService } from '@nestjs/config';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import {
  RabbitMqCollectorModule,
  RabbitMqPublishCollectorModule,
} from '@eleven-labs/nest-profiler-rabbitmq';
import { isProfilerEnabled } from '../../../config/profiler.config.js';
import rabbitmqConfig from '../../../config/rabbitmq.config.js';
import { EventPublisher } from '../../domain/event-publisher.js';
import { NotificationService } from '../../application/notification.service.js';
import { RabbitMqEventPublisher } from './rabbitmq.publisher.js';
import { NotificationConsumer } from './notification.consumer.js';
import {
  NOTIFICATIONS_DEAD_LETTER_EXCHANGE,
  NOTIFICATIONS_DEAD_LETTER_QUEUE,
  NOTIFICATIONS_EXCHANGE,
  NOTIFICATIONS_QUEUE,
  REVIEW_CREATED_ROUTING_KEY,
} from './rabbitmq.constants.js';

/**
 * RabbitMQ adapter for the notifications context. Selected when `FEATURE_RABBITMQ=true`. Wires the
 * broker connection + both RabbitMQ collectors (consumed messages, published ones),
 * binds/exports the {@link EventPublisher} port and registers the consumer that reacts to
 * `review.created` events.
 */
@Module({
  imports: [
    ConfigModule.forFeature(rabbitmqConfig),
    RabbitMQModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('rabbitmq.uri')!,
        // Single source of truth for the exchange name, shared with the publisher and the
        // consumer's @RabbitSubscribe decorator (which cannot read config at decoration time).
        exchanges: [
          { name: NOTIFICATIONS_EXCHANGE, type: 'topic', options: { durable: true } },
          { name: NOTIFICATIONS_DEAD_LETTER_EXCHANGE, type: 'topic', options: { durable: true } },
        ],
        // Declared here rather than only on the decorator, so the binding and the dead-letter
        // routing are part of the topology the Discover / RabbitMQ view reports.
        queues: [
          {
            name: NOTIFICATIONS_QUEUE,
            exchange: NOTIFICATIONS_EXCHANGE,
            routingKey: REVIEW_CREATED_ROUTING_KEY,
            options: {
              durable: true,
              arguments: { 'x-dead-letter-exchange': NOTIFICATIONS_DEAD_LETTER_EXCHANGE },
            },
          },
          // Nothing consumes it — it exists to show a queue the handler list cannot reveal.
          {
            name: NOTIFICATIONS_DEAD_LETTER_QUEUE,
            exchange: NOTIFICATIONS_DEAD_LETTER_EXCHANGE,
            routingKey: '#',
            options: { durable: true, messageTtl: 86_400_000 },
          },
        ],
        // Don't block bootstrap when the broker is unreachable — the demo app
        // still starts and the consumer connects once RabbitMQ is up.
        connectionInitOptions: { wait: false },
      }),
    }),
    // Profiles each consumed message as a `rabbitmq` entrypoint.
    ConditionalModule.registerWhen(RabbitMqCollectorModule.forRoot(), isProfilerEnabled),
    // Lists the events this context publishes in the RabbitMQ panel of the profile that emitted them.
    ConditionalModule.registerWhen(RabbitMqPublishCollectorModule.forRoot(), isProfilerEnabled),
  ],
  providers: [
    NotificationService,
    NotificationConsumer,
    { provide: EventPublisher, useClass: RabbitMqEventPublisher },
  ],
  exports: [EventPublisher],
})
export class NotificationsRabbitMqModule {}
