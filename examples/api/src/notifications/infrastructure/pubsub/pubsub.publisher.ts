import { Injectable } from '@nestjs/common';
import { PubSub } from '@google-cloud/pubsub';
import { EventPublisher } from '../../domain/event-publisher.js';
import type { DomainEvent } from '../../domain/domain-event.js';
import { PRODUCT_EVENTS_TOPIC } from './pubsub.constants.js';

/**
 * Google Cloud Pub/Sub adapter for the {@link EventPublisher} port. Publishes each domain event to
 * the product events topic, its name in the `eventType` attribute — captured by the Pub/Sub collector.
 * The publish is awaited, so the message id is known before the request's profile is saved.
 */
@Injectable()
export class PubSubEventPublisher implements EventPublisher {
  constructor(private readonly pubSub: PubSub) {}

  async publish(event: DomainEvent): Promise<void> {
    await this.pubSub.topic(PRODUCT_EVENTS_TOPIC).publishMessage({
      json: event.payload,
      attributes: { eventType: event.name, source: 'catalog' },
    });
  }
}
