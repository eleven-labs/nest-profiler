import { Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, ModuleRef, Reflector } from '@nestjs/core';
import { ProfilerCoreService, tryResolve } from '@eleven-labs/nest-profiler';
import type {
  DiscoverEntry,
  DiscoverGroup,
  DiscoverInputGroup,
  DiscoverInputItem,
  ProfilerDiscoverSource,
} from '@eleven-labs/nest-profiler';
import { EVENT_ICON } from './event-emitter-collector.interface';
import { scanEventListeners } from './event-listener-scan';
import type { DiscoveredListener } from './event-listener-scan';

/** Discriminator of this source, and the `?view=discover-event` key its view is filed under. */
const SOURCE = 'event';
/** Verb badge of a subscription, mirroring `@OnEvent` itself (`subscribe` for RabbitMQ, …). */
const METHOD = 'on';

/**
 * The subscription list of this source, named after the protocol — like its **Profiling / Events**
 * list section, so one transport carries one name — and counted as listeners, since a subscription
 * is not a route ("3 listeners").
 */
function buildGroup(entries: DiscoverEntry[]): DiscoverGroup {
  return { source: SOURCE, label: 'Events', icon: EVENT_ICON, itemLabel: 'listener', entries };
}

/**
 * The declared `@OnEvent` options, as one **Options** group — the decorator's own second argument,
 * given the treatment a CLI command's `@Option()` flags get. Only the enabled ones are listed: a
 * group repeating the defaults documents nothing, so a plain subscription has no group at all.
 */
function listenerOptions(listener: DiscoveredListener): DiscoverInputGroup[] {
  const items: DiscoverInputItem[] = [];
  if (listener.async) {
    items.push({
      name: 'async',
      description: 'The emitter awaits the handler — its rejection reaches an `emitAsync` caller.',
    });
  }
  if (listener.prepend) {
    items.push({
      name: 'prependListener',
      description: 'Registered ahead of the listeners already subscribed to the event.',
    });
  }
  return items.length > 0 ? [{ label: 'Options', items }] : [];
}

/**
 * A {@link ProfilerDiscoverSource} contributing the **Discover / Events** view. It lists every
 * `@OnEvent` subscription discovered across the providers and the controllers — the event name it
 * listens to, the declaring class, the handler method and the options it registered with — the
 * domain-event counterpart of the REST route table.
 *
 * Discovery itself lives in {@link scanEventListeners}, shared with {@link EventProfilerService},
 * so the view and the per-execution profiling see exactly the same set of subscriptions.
 */
@Injectable()
export class EventDiscoverSource implements ProfilerDiscoverSource, OnApplicationBootstrap {
  readonly type = SOURCE;
  private group: DiscoverGroup = buildGroup([]);

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    // `scanEventListeners` already returns the subscriptions sorted by event, class and method.
    const entries: DiscoverEntry[] = scanEventListeners(
      this.discovery,
      this.metadataScanner,
      this.reflector,
    ).map((listener) => {
      const groups = listenerOptions(listener);
      return {
        method: METHOD,
        path: listener.event,
        controller: listener.provider,
        handler: listener.method,
        ...(groups.length > 0 ? { inputs: { groups } } : {}),
      };
    });

    this.group = buildGroup(entries);

    tryResolve<ProfilerCoreService>(this.moduleRef, ProfilerCoreService)?.registerDiscoverSource(
      this,
    );
  }

  collect(): DiscoverGroup {
    return this.group;
  }
}
