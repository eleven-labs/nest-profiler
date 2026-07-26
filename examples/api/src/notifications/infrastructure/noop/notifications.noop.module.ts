import { Module } from '@nestjs/common';
import { EventPublisher } from '../../domain/event-publisher.js';
import { NoopEventPublisher } from './noop.publisher.js';

/**
 * Discard-everything adapter for the notifications context — the smallest possible implementation
 * of the {@link EventPublisher} port, kept as a reference.
 *
 * **Not wired by default.** The in-process `NotificationsEventEmitterModule` took that role: it also
 * needs zero infrastructure, but actually delivers the events (and gives the profiler something to
 * show). Swap it back in a bounded context that must publish nothing at all.
 */
@Module({
  providers: [{ provide: EventPublisher, useClass: NoopEventPublisher }],
  exports: [EventPublisher],
})
export class NotificationsNoopModule {}
