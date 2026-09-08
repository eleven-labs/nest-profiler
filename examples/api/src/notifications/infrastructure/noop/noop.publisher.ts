import { Injectable, Logger } from '@nestjs/common';
import { EventPublisher } from '../../domain/event-publisher.js';
import type { DomainEvent } from '../../domain/domain-event.js';

/**
 * No-op {@link EventPublisher}: accepts domain events and drops them. Kept as the minimal reference
 * implementation of the port — see {@link NotificationsNoopModule} for why it is not wired.
 */
@Injectable()
export class NoopEventPublisher implements EventPublisher {
  private readonly logger = new Logger(NoopEventPublisher.name);

  publish(event: DomainEvent): Promise<void> {
    this.logger.debug(`(no-op) event "${event.name}" discarded`);
    return Promise.resolve();
  }
}
