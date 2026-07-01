import type { DomainEvent } from './domain-event.js';

/**
 * Outbound port for publishing domain events. The abstract class doubles as the DI token: other
 * contexts inject `EventPublisher` and the notifications module binds it to the RabbitMQ adapter
 * (when a broker is configured) or to a no-op adapter (default), so publishers stay broker-agnostic.
 */
export abstract class EventPublisher {
  abstract publish(event: DomainEvent): Promise<void>;
}
