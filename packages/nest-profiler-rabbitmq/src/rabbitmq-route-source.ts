import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, ModuleRef } from '@nestjs/core';
import { RABBIT_HANDLER } from '@golevelup/nestjs-rabbitmq';
import { ProfilerCoreService } from '@eleven-labs/nest-profiler';
import type { ProfilerRouteSource, RouteEntry, RouteGroup } from '@eleven-labs/nest-profiler';

/** Inline SVG for the RabbitMQ group. */
const RABBITMQ_ICON = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M13 7h-2V3a1 1 0 00-1-1H8a1 1 0 00-1 1v4H5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V8a1 1 0 00-1-1zm-1 5h-2v-2h2v2z"/></svg>`;

/** Minimal view of the `@RabbitSubscribe` handler config we read from metadata. */
interface RabbitHandlerConfig {
  type?: string;
  exchange?: string;
  routingKey?: string | string[];
  queue?: string;
}

/**
 * A {@link ProfilerRouteSource} contributing a **RabbitMQ** group to the Routes panel. It scans the
 * providers for methods decorated with `@RabbitSubscribe` (`@golevelup/nestjs-rabbitmq` stores the
 * subscription config under the `RABBIT_HANDLER` metadata key) and lists each consumer with its
 * exchange, routing key and handler.
 */
@Injectable()
export class RabbitMqRouteSource implements ProfilerRouteSource, OnApplicationBootstrap {
  readonly type = 'rabbitmq';
  private group: RouteGroup = {
    source: 'rabbitmq',
    label: 'RabbitMQ',
    icon: RABBITMQ_ICON,
    routes: [],
  };

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly moduleRef: ModuleRef,
  ) {}

  onApplicationBootstrap(): void {
    const routes: RouteEntry[] = [];

    for (const wrapper of this.discovery.getProviders()) {
      if (!wrapper.instance || !wrapper.metatype) continue;
      const instance = wrapper.instance as Record<string, unknown>;
      const controller = (wrapper.metatype as { name: string }).name;
      const prototype = Object.getPrototypeOf(instance) as object;

      this.metadataScanner.scanFromPrototype(instance, prototype, (methodName) => {
        const methodRef = instance[methodName];
        if (typeof methodRef !== 'function') return;
        const config = Reflect.getMetadata(RABBIT_HANDLER, methodRef) as
          RabbitHandlerConfig | RabbitHandlerConfig[] | undefined;
        if (!config) return;
        for (const cfg of Array.isArray(config) ? config : [config]) {
          routes.push({
            method: cfg.type ?? 'subscribe',
            path: locator(cfg),
            controller,
            handler: methodName,
          });
        }
      });
    }

    routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
    this.group = { source: 'rabbitmq', label: 'RabbitMQ', icon: RABBITMQ_ICON, routes };

    try {
      this.moduleRef.get(ProfilerCoreService, { strict: false }).registerRouteSource(this);
    } catch {
      // ProfilerCoreService unavailable — the profiler is not configured.
    }
  }

  collect(): RouteGroup {
    return this.group;
  }
}

/** Builds a readable locator from a subscription config: `exchange → routingKey` (or queue). */
function locator(cfg: RabbitHandlerConfig): string {
  const routingKey = Array.isArray(cfg.routingKey) ? cfg.routingKey.join(', ') : cfg.routingKey;
  const target = routingKey ?? cfg.queue;
  if (cfg.exchange && target) return `${cfg.exchange} → ${target}`;
  return cfg.exchange ?? target ?? '(default)';
}
