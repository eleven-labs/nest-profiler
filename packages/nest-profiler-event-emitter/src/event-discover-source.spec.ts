import 'reflect-metadata';
import { DiscoveryService, MetadataScanner, ModuleRef, Reflector } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import { EventDiscoverSource } from './event-discover-source';

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

class OptionsListener {
  @OnEvent('order.paid', { async: true, prependListener: true })
  onPaid(): Promise<void> {
    return Promise.resolve();
  }
}

function buildSource(providers: unknown[], controllers: unknown[] = []) {
  const discovery = {
    getProviders: () => providers,
    getControllers: () => controllers,
  } as Partial<DiscoveryService> as DiscoveryService;
  const registerDiscoverSource = jest.fn();
  const get = jest.fn().mockReturnValue({ registerDiscoverSource });
  const source = new EventDiscoverSource(
    { get } as unknown as ModuleRef,
    discovery,
    new MetadataScanner(),
    new Reflector(),
  );
  return { source, registerDiscoverSource, get };
}

describe('EventDiscoverSource', () => {
  it('starts with an empty group before bootstrap', () => {
    const { source } = buildSource([{ instance: new ReviewListener() }]);
    expect(source.collect()).toMatchObject({
      source: 'event',
      label: 'Events',
      itemLabel: 'listener',
      entries: [],
    });
    expect(typeof source.collect().icon).toBe('string');
  });

  it('lists every @OnEvent subscription and registers with the core', () => {
    const { source, registerDiscoverSource } = buildSource([{ instance: new ReviewListener() }]);
    source.onApplicationBootstrap();

    expect(registerDiscoverSource).toHaveBeenCalledWith(source);
    const group = source.collect();
    expect(group).toMatchObject({ source: 'event', label: 'Events' });
    expect(group.entries).toEqual([
      {
        method: 'on',
        path: 'product.created',
        controller: 'ReviewListener',
        handler: 'onProductCreated',
      },
      {
        method: 'on',
        path: 'review.created',
        controller: 'ReviewListener',
        handler: 'onCreated',
      },
    ]);
  });

  it('documents the declared @OnEvent options as their own group', () => {
    const { source } = buildSource([{ instance: new OptionsListener() }]);
    source.onApplicationBootstrap();

    const groups = source.collect().entries[0]?.inputs?.groups ?? [];
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('Options');
    expect(groups[0]?.items.map((item) => item.name)).toEqual(['async', 'prependListener']);
    expect(groups[0]?.items.every((item) => typeof item.description === 'string')).toBe(true);
  });

  it('includes listeners declared on controllers', () => {
    const { source } = buildSource([], [{ instance: new ReviewController() }]);
    source.onApplicationBootstrap();

    expect(source.collect().entries).toEqual([
      { method: 'on', path: 'review.viewed', controller: 'ReviewController', handler: 'onViewed' },
    ]);
  });

  it('declares the event discover-source type', () => {
    expect(buildSource([]).source.type).toBe('event');
  });

  it('still builds the group when the profiler core is unavailable', () => {
    const { source, get } = buildSource([{ instance: new ReviewListener() }]);
    get.mockImplementation(() => {
      throw new Error('no core');
    });

    expect(() => source.onApplicationBootstrap()).not.toThrow();
    expect(source.collect().entries).toHaveLength(2);
  });

  it('produces an empty group when nothing subscribes', () => {
    const { source } = buildSource([{ instance: {} }]);
    source.onApplicationBootstrap();
    expect(source.collect().entries).toEqual([]);
  });
});
