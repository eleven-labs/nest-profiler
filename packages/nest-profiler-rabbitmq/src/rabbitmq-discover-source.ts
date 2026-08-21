import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, ModuleRef } from '@nestjs/core';
import { AmqpConnection, AmqpConnectionManager, RABBIT_HANDLER } from '@golevelup/nestjs-rabbitmq';
import type {
  MessageHandlerOptions,
  RabbitHandlerConfig,
  RabbitMQHandlers,
} from '@golevelup/nestjs-rabbitmq';
import { ProfilerCoreService } from '@eleven-labs/nest-profiler';
import type {
  DiscoverEntry,
  DiscoverGroup,
  ProfilerDiscoverSource,
} from '@eleven-labs/nest-profiler';
import { RABBITMQ_ICON } from './icons';
import { DEFAULT_EXCHANGE_LABEL } from './rabbitmq-labels';
import { describeSubscription } from './rabbitmq-subscription.describe';
import { connectionName, describeTopology } from './rabbitmq-topology.describe';
import type { DiscoveredRabbitMqConnection } from './rabbitmq-topology.describe';

/** Shown on a handler golevelup skips because its `name` matches no module-level handler config. */
const NOT_REGISTERED_DESCRIPTION =
  'Not registered: this handler references a module-level handler config that the connection does not declare.';

/** One `@RabbitSubscribe` config, resolved against the connection it is registered on. */
interface ResolvedSubscription {
  config: RabbitHandlerConfig;
  connection?: string;
  registered: boolean;
}

/**
 * Mirrors golevelup's own `resolveHandlerConfigs`: no lookup key means "use the decorator config
 * as-is", a key present in the `handlers` map contributes one registration per entry, and a key
 * absent from it means golevelup skips the handler entirely (rather than asserting a random
 * `amq.gen-*` queue).
 */
function moduleHandlerConfigs(
  handlers: RabbitMQHandlers,
  lookupKey: string | undefined,
): (MessageHandlerOptions | undefined)[] {
  if (!lookupKey) return [undefined];
  if (!Object.prototype.hasOwnProperty.call(handlers, lookupKey)) return [];
  const raw = handlers[lookupKey];
  return Array.isArray(raw) ? raw : [raw];
}

/** Builds a readable locator from a subscription config: `exchange → routingKey` (or queue). */
function locator(config: RabbitHandlerConfig): string {
  const routingKey = Array.isArray(config.routingKey)
    ? config.routingKey.join(', ')
    : config.routingKey;
  const target = routingKey ?? config.queue;
  if (config.exchange && target) return `${config.exchange} → ${target}`;
  return config.exchange ?? target ?? DEFAULT_EXCHANGE_LABEL;
}

/**
 * A {@link ProfilerDiscoverSource} contributing the **Discover / RabbitMQ** view.
 *
 * It lists two things the application declared at startup, which together make up its RabbitMQ
 * surface:
 *
 * - **the topology** — the connections, exchanges, queues and exchange bindings from the
 *   `RabbitMQModule` configuration, including the ones no handler consumes (dead-letter, retry and
 *   delay queues, exchanges the application only publishes to);
 * - **the handlers** — every method decorated with `@RabbitSubscribe` / `@RabbitRPC`
 *   (`@golevelup/nestjs-rabbitmq` stores the config under the `RABBIT_HANDLER` metadata key), with
 *   the full subscription: queue, exchange, routing keys, connection, queue options and error
 *   behaviour — the same treatment a CLI command's arguments and options get.
 *
 * Both are read from the resolved configuration, not from the broker: no management API, no
 * credentials, and the view stays accurate while RabbitMQ is unreachable.
 */
@Injectable()
export class RabbitMqDiscoverSource implements ProfilerDiscoverSource, OnApplicationBootstrap {
  readonly type = 'rabbitmq';
  private group: DiscoverGroup = {
    source: 'rabbitmq',
    label: 'RabbitMQ',
    icon: RABBITMQ_ICON,
    itemLabel: 'handler',
    entries: [],
  };

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly moduleRef: ModuleRef,
  ) {}

  onApplicationBootstrap(): void {
    const connections = this.discoverConnections();
    const entries = this.discoverHandlers(connections);

    entries.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
    this.group = {
      source: 'rabbitmq',
      label: 'RabbitMQ',
      icon: RABBITMQ_ICON,
      itemLabel: 'handler',
      entries,
      sections: describeTopology(connections),
    };

    try {
      this.moduleRef.get(ProfilerCoreService, { strict: false }).registerDiscoverSource(this);
    } catch {
      // ProfilerCoreService unavailable — the profiler is not configured.
    }
  }

  collect(): DiscoverGroup {
    return this.group;
  }

  /**
   * The declared connections, in declaration order. golevelup shares one `AmqpConnectionManager`
   * across every `RabbitMQModule` registration, so it holds every connection — including the
   * named ones a multi-vhost application declares. The per-module `AmqpConnection` providers are a
   * fallback for the case where no manager is exposed to the profiler's scope.
   */
  private discoverConnections(): DiscoveredRabbitMqConnection[] {
    const seen = new Set<AmqpConnection>();
    const connections: DiscoveredRabbitMqConnection[] = [];

    const add = (connection: AmqpConnection): void => {
      if (seen.has(connection)) return;
      seen.add(connection);
      try {
        const config = connection.configuration;
        connections.push({ name: connectionName(config), config });
      } catch {
        // A connection that cannot expose its configuration is simply not listed.
      }
    };

    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      if (instance instanceof AmqpConnectionManager) {
        for (const connection of instance.getConnections()) add(connection);
      } else if (instance instanceof AmqpConnection) {
        add(instance);
      }
    }

    return connections;
  }

  /** Every `@RabbitSubscribe` / `@RabbitRPC` method, resolved against the declared connections. */
  private discoverHandlers(connections: DiscoveredRabbitMqConnection[]): DiscoverEntry[] {
    const entries: DiscoverEntry[] = [];

    for (const wrapper of this.discovery.getProviders()) {
      if (!wrapper.instance || !wrapper.metatype) continue;
      const instance = wrapper.instance as Record<string, unknown>;
      const controller = (wrapper.metatype as { name: string }).name;
      const prototype = Object.getPrototypeOf(instance) as object;

      this.metadataScanner.scanFromPrototype(instance, prototype, (methodName) => {
        const methodRef = instance[methodName];
        if (typeof methodRef !== 'function') return;
        const metadata = Reflect.getMetadata(RABBIT_HANDLER, methodRef) as
          RabbitHandlerConfig | RabbitHandlerConfig[] | undefined;
        if (!metadata) return;

        for (const declared of Array.isArray(metadata) ? metadata : [metadata]) {
          for (const resolved of this.resolveSubscriptions(declared, connections)) {
            entries.push({
              method: resolved.config.type ?? 'subscribe',
              path: locator(resolved.config),
              controller,
              handler: methodName,
              ...(resolved.registered ? {} : { description: NOT_REGISTERED_DESCRIPTION }),
              inputs: { groups: describeSubscription(resolved.config, resolved.connection) },
            });
          }
        }
      });
    }

    return entries;
  }

  /**
   * Expands one decorator config into the registrations golevelup actually performs: a handler
   * pinned with `connection` targets that connection only, an unpinned one is registered on
   * **every** declared connection (the classic multi-vhost trap — worth showing as one entry per
   * connection), and a `name` is merged with the connection's module-level `handlers` entry, which
   * takes precedence exactly as golevelup merges it.
   */
  private resolveSubscriptions(
    config: RabbitHandlerConfig,
    connections: DiscoveredRabbitMqConnection[],
  ): ResolvedSubscription[] {
    // No connection discovered (the host wires golevelup out of the profiler's reach): describe
    // the decorator config on its own rather than dropping the handler.
    if (connections.length === 0) return [{ config, registered: true }];

    const targets = config.connection
      ? connections.filter((connection) => connection.name === config.connection)
      : connections;
    // Pinned to a connection that is not declared here: keep the handler visible under the name
    // it asked for, so the mismatch is diagnosable.
    if (targets.length === 0) {
      return [{ config, connection: config.connection, registered: true }];
    }

    const resolved: ResolvedSubscription[] = [];
    for (const target of targets) {
      const lookupKey = config.name ?? target.config.defaultHandler;
      const moduleConfigs = moduleHandlerConfigs(target.config.handlers ?? {}, lookupKey);
      if (moduleConfigs.length === 0) {
        resolved.push({ config, connection: target.name, registered: false });
        continue;
      }
      for (const moduleConfig of moduleConfigs) {
        resolved.push({
          config: { ...config, ...moduleConfig },
          connection: target.name,
          registered: true,
        });
      }
    }
    return resolved;
  }
}
