import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../../application/notification.service.js';

/**
 * In-process counterpart of the RabbitMQ `NotificationConsumer`: reacts to the domain events the
 * app emits through `EventEmitter2`. Each execution is profiled as its own `event` entrypoint by
 * `@eleven-labs/nest-profiler-event-emitter`, so the notification work shows up in `/_profiler`
 * with its own logs and duration rather than hiding inside the publishing request.
 */
@Injectable()
export class NotificationListener {
  constructor(private readonly notifications: NotificationService) {}

  @OnEvent('product.created')
  async onProductCreated(payload: Record<string, unknown>): Promise<void> {
    await this.notifications.notify({ name: 'product.created', payload });
  }

  @OnEvent('review.created')
  async onReviewCreated(payload: Record<string, unknown>): Promise<void> {
    await this.notifications.notify({ name: 'review.created', payload });
  }
}
