import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { RabbitMqCollectorModule } from '@eleven-labs/nest-profiler-rabbitmq';
import { isProfilerEnabled } from '../../../config/app.config.js';
import rabbitmqConfig from '../../../config/rabbitmq.config.js';
import { EventPublisher } from '../../domain/event-publisher.js';
import { NotificationService } from '../../application/notification.service.js';
import { RabbitMqEventPublisher } from './rabbitmq.publisher.js';
import { NotificationConsumer } from './notification.consumer.js';

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
        exchanges: [{ name: config.get<string>('rabbitmq.exchange')!, type: 'topic' }],
        // Don't block bootstrap when the broker is unreachable — the demo app
        // still starts and the consumer connects once RabbitMQ is up.
        connectionInitOptions: { wait: false },
      }),
    }),
    // Profiles each consumed message as a `rabbitmq` entrypoint.
    RabbitMqCollectorModule.forRoot({ enabled: isProfilerEnabled(process.env) }),
  ],
  providers: [
    NotificationService,
    NotificationConsumer,
    { provide: EventPublisher, useClass: RabbitMqEventPublisher },
  ],
  exports: [EventPublisher],
})
export class NotificationsRabbitMqModule {}
