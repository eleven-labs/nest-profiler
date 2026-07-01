import { Injectable, Logger } from '@nestjs/common';
import type { DomainEvent } from '../domain/domain-event.js';

/**
 * Reacts to incoming domain events by "sending" a notification. The work is simulated (a short
 * delay) so the consumed message has a measurable duration in the profiler. Invoked by the RabbitMQ
 * consumer when a broker is available.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  async notify(event: DomainEvent): Promise<void> {
    this.logger.log(`Received "${event.name}" — sending notification`);
    await new Promise((resolve) => setTimeout(resolve, 25));
    this.logger.log(`Notification sent for "${event.name}"`);
  }
}
