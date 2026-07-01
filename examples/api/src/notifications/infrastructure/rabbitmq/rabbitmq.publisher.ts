import { Injectable } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { EventPublisher } from '../../domain/event-publisher.js';
import type { DomainEvent } from '../../domain/domain-event.js';
import { NOTIFICATIONS_EXCHANGE } from './rabbitmq.constants.js';

/**
 * RabbitMQ adapter for the {@link EventPublisher} port. Publishes each domain event to the demo
 * exchange, using the event name as the routing key — captured by the RabbitMQ collector.
 */
@Injectable()
export class RabbitMqEventPublisher implements EventPublisher {
  constructor(private readonly amqp: AmqpConnection) {}

  async publish(event: DomainEvent): Promise<void> {
    await this.amqp.publish(NOTIFICATIONS_EXCHANGE, event.name, event.payload);
  }
}
