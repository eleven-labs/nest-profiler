import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventPublisher } from '../../domain/event-publisher.js';
import type { DomainEvent } from '../../domain/domain-event.js';

/**
 * In-process {@link EventPublisher} — the default adapter, since `@nestjs/event-emitter` needs no
 * infrastructure at all. `emitAsync` is used on purpose: it awaits the subscribed handlers, so the
 * publishing request's profile shows the real dispatch duration in its Events panel.
 */
@Injectable()
export class EventEmitterPublisher implements EventPublisher {
  private readonly logger = new Logger(EventEmitterPublisher.name);

  constructor(private readonly emitter: EventEmitter2) {}

  async publish(event: DomainEvent): Promise<void> {
    this.logger.debug(`Emitting "${event.name}" in-process`);
    await this.emitter.emitAsync(event.name, event.payload);
  }
}
