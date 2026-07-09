import 'reflect-metadata';
import { DiscoveryService, MetadataScanner, ModuleRef } from '@nestjs/core';
import { RABBIT_HANDLER } from '@golevelup/nestjs-rabbitmq';
import { RabbitMqRouteSource } from './rabbitmq-route-source';

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

function buildSource(providers: { instance: object; metatype: unknown }[]) {
  const discovery = {
    getProviders: () => providers,
  } as Partial<DiscoveryService> as DiscoveryService;
  const scanner = {
    scanFromPrototype: (instance: object, _proto: object, cb: (name: string) => void) => {
      for (const name of Object.keys(instance)) cb(name);
    },
  } as Partial<MetadataScanner> as MetadataScanner;
  const registerRouteSource = jest.fn();
  const get = jest.fn().mockReturnValue({ registerRouteSource });
  const source = new RabbitMqRouteSource(discovery, scanner, { get } as unknown as ModuleRef);
  return { source, registerRouteSource, get };
}

describe('RabbitMqRouteSource', () => {
  const wrapper = { instance: new OrdersConsumer(), metatype: OrdersConsumer };

  it('discovers @RabbitSubscribe handlers and registers with the core', () => {
    const { source, registerRouteSource } = buildSource([wrapper]);
    source.onApplicationBootstrap();

    expect(registerRouteSource).toHaveBeenCalledWith(source);
    const group = source.collect();
    expect(group).toMatchObject({ source: 'rabbitmq', label: 'RabbitMQ' });
    expect(group.routes).toEqual([
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

  it('joins array routing keys and falls back to the default locator', () => {
    class C {
      multi = handler({ exchange: 'events', routingKey: ['a', 'b'] });
      bare = handler({});
    }
    const { source } = buildSource([{ instance: new C(), metatype: C }]);
    source.onApplicationBootstrap();
    const paths = source.collect().routes.map((r) => r.path);
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
    expect(source.collect().routes.map((r) => r.method)).toEqual(['rpc', 'subscribe']);
  });

  it('returns an empty group and does not throw when the core is unavailable', () => {
    const { source, get } = buildSource([wrapper]);
    get.mockImplementation(() => {
      throw new Error('no core');
    });
    expect(() => source.onApplicationBootstrap()).not.toThrow();
    expect(source.collect().routes.length).toBe(2);
  });

  it('ignores providers without an instance or metatype', () => {
    const { source } = buildSource([
      { instance: undefined as unknown as object, metatype: undefined },
    ]);
    source.onApplicationBootstrap();
    expect(source.collect().routes).toEqual([]);
  });
});
