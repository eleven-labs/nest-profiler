import 'reflect-metadata';
import { DiscoveryService, MetadataScanner, ModuleRef, Reflector } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import { EventRouteSource } from './event-route-source';

class ReviewListener {
  @OnEvent('review.created')
  onCreated(): void {}

  @OnEvent('product.created')
  onProductCreated(): void {}
}

class ReviewController {
  @OnEvent('review.viewed')
  onViewed(): void {}
}

function buildSource(providers: unknown[], controllers: unknown[] = []) {
  const discovery = {
    getProviders: () => providers,
    getControllers: () => controllers,
  } as Partial<DiscoveryService> as DiscoveryService;
  const registerRouteSource = jest.fn();
  const get = jest.fn().mockReturnValue({ registerRouteSource });
  const source = new EventRouteSource(
    { get } as unknown as ModuleRef,
    discovery,
    new MetadataScanner(),
    new Reflector(),
  );
  return { source, registerRouteSource, get };
}

describe('EventRouteSource', () => {
  it('starts with an empty group before bootstrap', () => {
    const { source } = buildSource([{ instance: new ReviewListener() }]);
    expect(source.collect()).toMatchObject({
      source: 'event',
      label: 'Event Listeners',
      routes: [],
    });
    expect(typeof source.collect().icon).toBe('string');
  });

  it('lists every @OnEvent subscription and registers with the core', () => {
    const { source, registerRouteSource } = buildSource([{ instance: new ReviewListener() }]);
    source.onApplicationBootstrap();

    expect(registerRouteSource).toHaveBeenCalledWith(source);
    const group = source.collect();
    expect(group).toMatchObject({ source: 'event', label: 'Event Listeners' });
    expect(group.routes).toEqual([
      {
        method: 'ON',
        path: 'product.created',
        controller: 'ReviewListener',
        handler: 'onProductCreated',
      },
      {
        method: 'ON',
        path: 'review.created',
        controller: 'ReviewListener',
        handler: 'onCreated',
      },
    ]);
  });

  it('includes listeners declared on controllers', () => {
    const { source } = buildSource([], [{ instance: new ReviewController() }]);
    source.onApplicationBootstrap();

    expect(source.collect().routes).toEqual([
      { method: 'ON', path: 'review.viewed', controller: 'ReviewController', handler: 'onViewed' },
    ]);
  });

  it('declares the event route-source type', () => {
    expect(buildSource([]).source.type).toBe('event');
  });

  it('still builds the group when the profiler core is unavailable', () => {
    const { source, get } = buildSource([{ instance: new ReviewListener() }]);
    get.mockImplementation(() => {
      throw new Error('no core');
    });

    expect(() => source.onApplicationBootstrap()).not.toThrow();
    expect(source.collect().routes).toHaveLength(2);
  });

  it('produces an empty group when nothing subscribes', () => {
    const { source } = buildSource([{ instance: {} }]);
    source.onApplicationBootstrap();
    expect(source.collect().routes).toEqual([]);
  });
});
