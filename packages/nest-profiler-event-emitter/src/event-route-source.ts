import { Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, ModuleRef, Reflector } from '@nestjs/core';
import { ProfilerCoreService, tryResolve } from '@eleven-labs/nest-profiler';
import type { ProfilerRouteSource, RouteGroup } from '@eleven-labs/nest-profiler';
import { EVENT_ICON } from './event-emitter-collector.interface';
import { scanEventListeners } from './event-listener-scan';

/**
 * Contributes `@OnEvent` subscriptions to the home "Routes" panel as an "Event Listeners" group,
 * through the same registry REST controllers, GraphQL and CLI commands use.
 */
@Injectable()
export class EventRouteSource implements ProfilerRouteSource, OnApplicationBootstrap {
  readonly type = 'event';
  private group: RouteGroup = {
    source: 'event',
    label: 'Event Listeners',
    icon: EVENT_ICON,
    routes: [],
  };

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  collect(): RouteGroup {
    return this.group;
  }

  onApplicationBootstrap(): void {
    const listeners = scanEventListeners(this.discovery, this.metadataScanner, this.reflector);
    this.group = {
      source: 'event',
      label: 'Event Listeners',
      icon: EVENT_ICON,
      routes: listeners.map((listener) => ({
        method: 'ON',
        path: listener.event,
        controller: listener.provider,
        handler: listener.method,
      })),
    };

    const core = tryResolve<ProfilerCoreService>(this.moduleRef, ProfilerCoreService);
    core?.registerRouteSource(this);
  }
}
