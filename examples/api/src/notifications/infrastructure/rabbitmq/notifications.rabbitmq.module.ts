import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule, ConfigService } from '@nestjs/config';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { RabbitMqCollectorModule } from '@eleven-labs/nest-profiler-rabbitmq';
import { isProfilerEnabled } from '../../../config/profiler.config.js';
import rabbitmqConfig from '../../../config/rabbitmq.config.js';
import { EventPublisher } from '../../domain/event-publisher.js';
import { NotificationService } from '../../application/notification.service.js';
import { RabbitMqEventPublisher } from './rabbitmq.publisher.js';
import { NotificationConsumer } from './notification.consumer.js';
import { NOTIFICATIONS_EXCHANGE } from './rabbitmq.constants.js';

/**
 * RabbitMQ adapter for the notifications context. Selected when `FEATURE_RABBITMQ=true`. Wires the
 * broker connection + the RabbitMQ collector, binds/exports the {@link EventPublisher} port and
 * registers the consumer that reacts to `review.created` events.
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
        exchanges: [{ name: NOTIFICATIONS_EXCHANGE, type: 'topic' }],
        // Don't block bootstrap when the broker is unreachable — the demo app
        // still starts and the consumer connects once RabbitMQ is up.
        connectionInitOptions: { wait: false },
      }),
    }),
    // Profiles each consumed message as a `rabbitmq` entrypoint.
    ConditionalModule.registerWhen(RabbitMqCollectorModule.forRoot(), isProfilerEnabled),
  ],
  providers: [
    NotificationService,
    NotificationConsumer,
    { provide: EventPublisher, useClass: RabbitMqEventPublisher },
  ],
  exports: [EventPublisher],
})
export class NotificationsRabbitMqModule {}
