import { Injectable, Logger } from '@nestjs/common';
import { EventPublisher } from '../../domain/event-publisher.js';
import type { DomainEvent } from '../../domain/domain-event.js';

/**
 * No-op {@link EventPublisher} — the default when no RabbitMQ broker is configured. Lets contexts
 * publish domain events (e.g. `review.created`) without any messaging infrastructure, so the app
 * runs unchanged on serverless deploys.
 */
@Injectable()
export class NoopEventPublisher implements EventPublisher {
  private readonly logger = new Logger(NoopEventPublisher.name);

  publish(event: DomainEvent): Promise<void> {
    this.logger.debug(`(no-op) event "${event.name}" not published — RabbitMQ disabled`);
    return Promise.resolve();
  }
}
