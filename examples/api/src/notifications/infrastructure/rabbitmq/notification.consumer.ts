import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import type { ConsumeMessage } from 'amqplib';
import { NotificationService } from '../../application/notification.service.js';
import {
  NOTIFICATIONS_EXCHANGE,
  NOTIFICATIONS_QUEUE,
  REVIEW_CREATED_ROUTING_KEY,
} from './rabbitmq.constants.js';

/**
 * Consumes `review.created` events off RabbitMQ and delegates to {@link NotificationService}. The
 * global `ProfilerInterceptor` detects the `rmq` context and `RabbitMqCollectorModule` profiles
 * this handler as a `rabbitmq` entrypoint — visible at `/_profiler` with a Message tab.
 */
@Injectable()
export class NotificationConsumer {
  constructor(private readonly notifications: NotificationService) {}

  @RabbitSubscribe({
    exchange: NOTIFICATIONS_EXCHANGE,
    routingKey: REVIEW_CREATED_ROUTING_KEY,
    queue: NOTIFICATIONS_QUEUE,
  })
  async handleReviewCreated(payload: Record<string, unknown>, raw: ConsumeMessage): Promise<void> {
    await this.notifications.notify({ name: raw.fields.routingKey, payload });
  }
}
