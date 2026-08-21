import 'reflect-metadata';
import { DiscoveryService, MetadataScanner, ModuleRef } from '@nestjs/core';
import { AmqpConnection, AmqpConnectionManager, RABBIT_HANDLER } from '@golevelup/nestjs-rabbitmq';
import type { RabbitMQConfig } from '@golevelup/nestjs-rabbitmq';
import { RabbitMqDiscoverSource } from './rabbitmq-discover-source';

function handler(config: unknown) {
  const fn = function () {};
  Reflect.defineMetadata(RABBIT_HANDLER, config, fn);
  return fn;
}

class OrdersConsumer {
  onCreated = handler({ type: 'subscribe', exchange: 'orders', routingKey: 'order.created' });
  onArchived = handler({ type: 'subscribe', queue: 'orders-archive' });
  plain = function () {};
}

/** A real `AmqpConnection` shape (the source narrows on `instanceof`) over a plain config. */
function fakeConnection(config: Partial<RabbitMQConfig>): AmqpConnection {
  const connection = Object.create(AmqpConnection.prototype) as AmqpConnection;
  // `configuration` is a getter over the connection's private config field — shadow it with data.
  Object.defineProperty(connection, 'configuration', {
    value: { uri: 'amqp://localhost', ...config } satisfies Partial<RabbitMQConfig>,
  });
  return connection;
}

function fakeManager(...configs: Partial<RabbitMQConfig>[]): AmqpConnectionManager {
  const manager = new AmqpConnectionManager();
  for (const config of configs) manager.addConnection(fakeConnection(config));
  return manager;
}

function buildSource(providers: { instance: unknown; metatype?: unknown }[]) {
  const discovery = {
    getProviders: () => providers,
  } as Partial<DiscoveryService> as DiscoveryService;
  const scanner = {
    scanFromPrototype: (instance: object, _proto: object, cb: (name: string) => void) => {
      for (const name of Object.keys(instance)) cb(name);
    },
  } as Partial<MetadataScanner> as MetadataScanner;
  const registerDiscoverSource = jest.fn();
  const get = jest.fn().mockReturnValue({ registerDiscoverSource });
  const source = new RabbitMqDiscoverSource(discovery, scanner, { get } as unknown as ModuleRef);
  return { source, registerDiscoverSource, get };
}

describe('RabbitMqDiscoverSource', () => {
  const wrapper = { instance: new OrdersConsumer(), metatype: OrdersConsumer };

  it('discovers @RabbitSubscribe handlers and registers with the core', () => {
    const { source, registerDiscoverSource } = buildSource([wrapper]);
    source.onApplicationBootstrap();

    expect(registerDiscoverSource).toHaveBeenCalledWith(source);
    const group = source.collect();
    expect(group).toMatchObject({ source: 'rabbitmq', label: 'RabbitMQ', itemLabel: 'handler' });
    expect(
      group.entries.map(({ method, path, controller, handler: name }) => ({
        method,
        path,
        controller,
        handler: name,
      })),
    ).toEqual([
      {
        method: 'subscribe',
        path: 'orders → order.created',
        controller: 'OrdersConsumer',
        handler: 'onCreated',
      },
      {
        method: 'subscribe',
        path: 'orders-archive',
        controller: 'OrdersConsumer',
        handler: 'onArchived',
      },
    ]);
  });

  it('describes each handler subscription, the way a command documents its options', () => {
    const { source } = buildSource([wrapper]);
    source.onApplicationBootstrap();

    expect(source.collect().entries[0]?.inputs?.groups).toEqual([
      {
        label: 'Subscription',
        items: [
          { name: 'queue', description: '(broker-generated)' },
          { name: 'exchange', description: 'orders' },
          { name: 'routingKey', description: 'order.created' },
        ],
      },
    ]);
  });

  it('joins array routing keys and falls back to the default locator', () => {
    class C {
      multi = handler({ exchange: 'events', routingKey: ['a', 'b'] });
      bare = handler({});
    }
    const { source } = buildSource([{ instance: new C(), metatype: C }]);
    source.onApplicationBootstrap();
    const paths = source.collect().entries.map((r) => r.path);
    expect(paths).toContain('events → a, b');
    expect(paths).toContain('(default)');
  });

  it('expands an array of configs on one handler, orders by method, and skips non-functions', () => {
    class Multi {
      note = 42; // non-function property — must be ignored
      handle = handler([
        { type: 'subscribe', exchange: 'x', routingKey: 'k' },
        { type: 'rpc', exchange: 'x', routingKey: 'k' },
      ]);
    }
    const { source } = buildSource([{ instance: new Multi(), metatype: Multi }]);
    source.onApplicationBootstrap();
    // Same path, so the method comparator decides the order (rpc before subscribe).
    expect(source.collect().entries.map((r) => r.method)).toEqual(['rpc', 'subscribe']);
  });

  it('returns an empty group and does not throw when the core is unavailable', () => {
    const { source, get } = buildSource([wrapper]);
    get.mockImplementation(() => {
      throw new Error('no core');
    });
    expect(() => source.onApplicationBootstrap()).not.toThrow();
    expect(source.collect().entries.length).toBe(2);
  });

  it('ignores providers without an instance or metatype', () => {
    const { source } = buildSource([{ instance: undefined, metatype: undefined }]);
    source.onApplicationBootstrap();
    expect(source.collect().entries).toEqual([]);
  });

  describe('topology', () => {
    it('contributes the declared connections, exchanges and queues as sections', () => {
      const { source } = buildSource([
        wrapper,
        {
          instance: fakeManager({
            name: 'default',
            exchanges: [{ name: 'orders', type: 'topic' }],
            queues: [{ name: 'orders-archive', options: { durable: true } }],
          }),
        },
      ]);
      source.onApplicationBootstrap();

      const sections = source.collect().sections ?? [];
      expect(sections.map((section) => section.label)).toEqual([
        'Connections',
        'Exchanges',
        'Queues',
      ]);
      expect(sections[1]?.items).toEqual([{ name: 'orders', kind: 'topic' }]);
      expect(sections[2]?.items[0]).toMatchObject({ name: 'orders-archive', flags: ['durable'] });
    });

    it('reads the topology off a bare AmqpConnection provider too', () => {
      const { source } = buildSource([
        { instance: fakeConnection({ name: 'tts', exchanges: [{ name: 'tts.retry' }] }) },
      ]);
      source.onApplicationBootstrap();
      expect(source.collect().sections?.[1]?.items).toEqual([{ name: 'tts.retry' }]);
    });

    it('lists a connection once when the manager and its connection are both exposed', () => {
      const connection = fakeConnection({ name: 'tts' });
      const manager = new AmqpConnectionManager();
      manager.addConnection(connection);
      const { source } = buildSource([{ instance: manager }, { instance: connection }]);
      source.onApplicationBootstrap();
      expect(source.collect().sections?.[0]?.items).toEqual([
        { name: 'tts', detail: 'amqp://localhost' },
      ]);
    });
  });

  describe('connection resolution', () => {
    class Pinned {
      handle = handler({ type: 'subscribe', queue: 'q', connection: 'tts' });
    }
    class Unpinned {
      handle = handler({ type: 'subscribe', queue: 'q' });
    }

    it('names the connection a handler is pinned to', () => {
      const { source } = buildSource([
        { instance: new Pinned(), metatype: Pinned },
        { instance: fakeManager({ name: 'article-notification' }, { name: 'tts' }) },
      ]);
      source.onApplicationBootstrap();

      const entries = source.collect().entries;
      expect(entries).toHaveLength(1);
      expect(entries[0]?.inputs?.groups?.[0]?.items).toContainEqual({
        name: 'connection',
        description: 'tts',
      });
    });

    it('lists an unpinned handler once per connection — golevelup registers it on every one', () => {
      const { source } = buildSource([
        { instance: new Unpinned(), metatype: Unpinned },
        { instance: fakeManager({ name: 'article-notification' }, { name: 'tts' }) },
      ]);
      source.onApplicationBootstrap();

      expect(
        source
          .collect()
          .entries.map(
            (entry) =>
              entry.inputs?.groups?.[0]?.items.find((item) => item.name === 'connection')
                ?.description,
          ),
      ).toEqual(['article-notification', 'tts']);
    });

    it('keeps a handler pinned to an undeclared connection visible under that name', () => {
      const { source } = buildSource([
        { instance: new Pinned(), metatype: Pinned },
        { instance: fakeManager({ name: 'article-notification' }) },
      ]);
      source.onApplicationBootstrap();
      expect(source.collect().entries[0]?.inputs?.groups?.[0]?.items).toContainEqual({
        name: 'connection',
        description: 'tts',
      });
    });

    it('merges a module-level handler config, which takes precedence as golevelup merges it', () => {
      class Named {
        handle = handler({ type: 'subscribe', name: 'narration', queue: 'from-decorator' });
      }
      const { source } = buildSource([
        { instance: new Named(), metatype: Named },
        {
          instance: fakeManager({
            name: 'default',
            handlers: { narration: { queue: 'from-module', exchange: 'articles.events' } },
          }),
        },
      ]);
      source.onApplicationBootstrap();

      const items = source.collect().entries[0]?.inputs?.groups?.[0]?.items;
      expect(items).toContainEqual({ name: 'queue', description: 'from-module' });
      expect(items).toContainEqual({ name: 'exchange', description: 'articles.events' });
      expect(items).toContainEqual({ name: 'handler config', description: 'narration' });
    });

    it('flags a handler whose named config the connection does not declare — golevelup skips it', () => {
      class Named {
        handle = handler({ type: 'subscribe', name: 'missing', queue: 'q' });
      }
      const { source } = buildSource([
        { instance: new Named(), metatype: Named },
        { instance: fakeManager({ name: 'default', handlers: {} }) },
      ]);
      source.onApplicationBootstrap();
      expect(source.collect().entries[0]?.description).toContain('Not registered');
    });
  });
});
