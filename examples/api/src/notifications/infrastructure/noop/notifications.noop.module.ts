import { Module } from '@nestjs/common';
import { EventPublisher } from '../../domain/event-publisher.js';
import { NoopEventPublisher } from './noop.publisher.js';

/**
 * No-infrastructure adapter for the notifications context — the default when `FEATURE_RABBITMQ` is
 * off. Sole provider/exporter of the {@link EventPublisher} port, bound to the no-op publisher.
 */
@Module({
  providers: [{ provide: EventPublisher, useClass: NoopEventPublisher }],
  exports: [EventPublisher],
})
export class NotificationsNoopModule {}
