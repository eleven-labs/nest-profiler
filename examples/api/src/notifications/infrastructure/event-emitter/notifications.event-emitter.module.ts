import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventEmitterCollectorModule } from '@eleven-labs/nest-profiler-event-emitter';
import { isProfilerEnabled } from '../../../config/profiler.config.js';
import { EventPublisher } from '../../domain/event-publisher.js';
import { NotificationService } from '../../application/notification.service.js';
import { EventEmitterPublisher } from './event-emitter.publisher.js';
import { NotificationListener } from './notification.listener.js';

/**
 * In-process adapter for the notifications context — the default, because it needs no broker. Wires
 * `EventEmitterModule` (global, so `EventEmitter2` is injectable everywhere) + the event-emitter
 * collector, binds/exports the {@link EventPublisher} port and registers the `@OnEvent` listeners.
 *
 * Imported by both the catalog and the reviews contexts; Nest instantiates it once, so the
 * collector and the listeners are registered a single time.
 */
@Module({
  imports: [
    EventEmitterModule.forRoot(),
    // Adds the Events panel to the emitting profile, the "Event Listeners" Routes group, and one
    // `event` profile per @OnEvent execution. `forRootAsync` drives the tagging thresholds from
    // config; gating stays ConditionalModule's job.
    ConditionalModule.registerWhen(
      EventEmitterCollectorModule.forRootAsync({
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          slowThreshold: config.get<number>('profiler.performance.slowThreshold'),
          nPlusOneThreshold: config.get<number>('profiler.performance.nPlusOneThreshold'),
          chattyThreshold: config.get<number>('profiler.performance.chattyThreshold'),
          slowSeverity: config.get<'info' | 'warning' | 'danger'>(
            'profiler.performance.slowSeverity',
          ),
        }),
      }),
      isProfilerEnabled,
    ),
  ],
  providers: [
    NotificationService,
    NotificationListener,
    { provide: EventPublisher, useClass: EventEmitterPublisher },
  ],
  exports: [EventPublisher],
})
export class NotificationsEventEmitterModule {}
