import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import { ConfigurableModuleClass } from './event-emitter-collector.interface';
import type {
  EventEmitterCollectorModuleAsyncOptions,
  EventEmitterCollectorModuleOptions,
} from './event-emitter-collector.interface';
import { EventEmitterCollector } from './event-emitter.collector';
import { EventEmitterPatch } from './event-emitter.patch';
import { EventProfilerService } from './event-profiler.service';
import { EventRouteSource } from './event-route-source';

// `EventProfilerService` registers the `event` entrypoint type and wraps the `@OnEvent` handlers,
// `EventRouteSource` self-registers at bootstrap; both need DiscoveryModule (DiscoveryService +
// MetadataScanner) to scan the DI container.
const SHAPE: CollectorModuleShape = {
  imports: [DiscoveryModule],
  providers: [EventEmitterPatch, EventEmitterCollector, EventProfilerService, EventRouteSource],
};

/**
 * Captures every event dispatched through `@nestjs/event-emitter` and surfaces them in the web
 * profiler as an **Events** panel on the emitting profile, an **Event Listeners** group in the
 * Routes panel, and — unless `profileListeners` is off — one `event` profile per `@OnEvent`
 * execution, with its own logs, queries and outgoing HTTP calls.
 */
@Module({})
export class EventEmitterCollectorModule extends ConfigurableModuleClass {
  static forRoot(options: EventEmitterCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, SHAPE);
  }

  /**
   * Async variant — resolve the options (e.g. `ignoreEvents`, `slowThreshold`) from DI such as
   * `ConfigService`. Gating stays the host's job via `ConditionalModule.registerWhen`.
   */
  static forRootAsync(options: EventEmitterCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, SHAPE);
  }
}
