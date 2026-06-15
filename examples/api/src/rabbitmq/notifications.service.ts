import { Injectable, Logger } from '@nestjs/common';
import { AmqpConnection, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import type { ConsumeMessage } from 'amqplib';

/** Exchange and routing key the demo publishes to and subscribes from. */
export const NOTIFICATIONS_EXCHANGE = 'profiler.demo';
export const NOTIFICATION_ROUTING_KEY = 'notification.created';

export interface NotificationMessage {
  subject: string;
  body: string;
  publishedAt: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly amqp: AmqpConnection) {}

  /** Publishes a message — triggers the `@RabbitSubscribe` handler below. */
  async publish(message: NotificationMessage): Promise<void> {
    await this.amqp.publish(NOTIFICATIONS_EXCHANGE, NOTIFICATION_ROUTING_KEY, message);
  }

  /**
   * Consumes the published message. The global `ProfilerInterceptor` detects the
   * `rmq` execution context and `RabbitMqCollectorModule` profiles this handler
   * as a `rabbitmq` entrypoint — visible at `/_profiler` with a Message tab.
   */
  @RabbitSubscribe({
    exchange: NOTIFICATIONS_EXCHANGE,
    routingKey: NOTIFICATION_ROUTING_KEY,
    queue: 'profiler.demo.notifications',
  })
  async handleNotification(message: NotificationMessage, raw: ConsumeMessage): Promise<void> {
    this.logger.log(`Received "${message.subject}" via ${raw.fields.routingKey}`);
    // Simulate some work so the message profile has a measurable duration.
    await new Promise((resolve) => setTimeout(resolve, 25));
    this.logger.log(`Processed notification "${message.subject}"`);
  }
}
