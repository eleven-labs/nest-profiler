import 'reflect-metadata';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import { findHandlerFn, scanEventListeners, toEventName } from './event-listener-scan';

class ReviewListener {
  @OnEvent('review.created')
  onCreated(): void {}

  @OnEvent('review.deleted', { async: true })
  @OnEvent('review.archived', { prependListener: true })
  onGone(): void {}

  plain(): void {}
}

class ReviewController {
  @OnEvent('review.viewed')
  onViewed(): void {}
}

/** Reads a method off a prototype without creating an unbound method reference. */
function methodOf(proto: object, name: string): unknown {
  return Object.getOwnPropertyDescriptor(proto, name)?.value;
}

/** A provider whose listener is inherited from a base class. */
class BaseListener {
  @OnEvent('base.ping')
  onPing(): void {}
}
class DerivedListener extends BaseListener {}

type Wrapper = { instance: unknown; isAlias?: boolean };

function buildDiscovery(providers: Wrapper[], controllers: Wrapper[] = []): DiscoveryService {
  return {
    getProviders: () => providers,
    getControllers: () => controllers,
  } as Partial<DiscoveryService> as DiscoveryService;
}

function scan(providers: Wrapper[], controllers: Wrapper[] = []) {
  return scanEventListeners(
    buildDiscovery(providers, controllers),
    new MetadataScanner(),
    new Reflector(),
  );
}

describe('toEventName', () => {
  it('keeps a string as-is', () => {
    expect(toEventName('a.b')).toBe('a.b');
  });

  it('joins a namespaced array with dots', () => {
    expect(toEventName(['a', 'b'])).toBe('a.b');
  });

  it('stringifies anything else', () => {
    expect(toEventName(Symbol.for('sym'))).toBe('Symbol(sym)');
  });
});

describe('findHandlerFn', () => {
  it('finds a method on the prototype even when the instance property is overwritten', () => {
    const instance = new ReviewListener();
    const original = methodOf(ReviewListener.prototype, 'onCreated');
    (instance as unknown as Record<string, unknown>)['onCreated'] = () => 'wrapped';

    expect(findHandlerFn(instance, 'onCreated')).toBe(original);
  });

  it('walks up the prototype chain', () => {
    expect(findHandlerFn(new DerivedListener(), 'onPing')).toBe(
      methodOf(BaseListener.prototype, 'onPing'),
    );
  });

  it('returns undefined for an unknown method', () => {
    expect(findHandlerFn(new ReviewListener(), 'nope')).toBeUndefined();
  });
});

describe('scanEventListeners', () => {
  it('discovers @OnEvent handlers on providers, sorted by event name', () => {
    const listeners = scan([{ instance: new ReviewListener() }]);

    expect(listeners.map((l) => l.event)).toEqual([
      'review.archived',
      'review.created',
      'review.deleted',
    ]);
    expect(listeners[0]).toMatchObject({ provider: 'ReviewListener', method: 'onGone' });
  });

  it('carries the @OnEvent options', () => {
    const listeners = scan([{ instance: new ReviewListener() }]);
    const byEvent = Object.fromEntries(listeners.map((l) => [l.event, l]));

    expect(byEvent['review.deleted']).toMatchObject({ async: true, prepend: false });
    expect(byEvent['review.archived']).toMatchObject({ async: false, prepend: true });
    expect(byEvent['review.created']).toMatchObject({ async: false, prepend: false });
  });

  it('discovers @OnEvent handlers declared on controllers', () => {
    const listeners = scan([], [{ instance: new ReviewController() }]);

    expect(listeners).toHaveLength(1);
    expect(listeners[0]).toMatchObject({
      event: 'review.viewed',
      provider: 'ReviewController',
      method: 'onViewed',
    });
  });

  it('discovers listeners inherited from a base class', () => {
    expect(scan([{ instance: new DerivedListener() }])[0]).toMatchObject({
      event: 'base.ping',
      provider: 'DerivedListener',
    });
  });

  it('deduplicates the same subscription seen twice', () => {
    const instance = new ReviewController();
    expect(scan([{ instance }], [{ instance }])).toHaveLength(1);
  });

  it('skips aliases, missing instances and non-object instances', () => {
    const listeners = scan([
      { instance: new ReviewController(), isAlias: true },
      { instance: null },
      { instance: undefined },
      { instance: 'a string' },
    ]);

    expect(listeners).toEqual([]);
  });

  it('ignores methods without @OnEvent metadata', () => {
    expect(scan([{ instance: new ReviewListener() }]).map((l) => l.method)).not.toContain('plain');
  });

  it('skips a prototype-less instance', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare['onCreated'] = methodOf(ReviewListener.prototype, 'onCreated');
    expect(scan([{ instance: bare }])).toEqual([]);
  });

  it('falls back to Unknown when the instance has no constructor name', () => {
    const orphan = Object.create({
      onCreated: methodOf(ReviewListener.prototype, 'onCreated'),
      constructor: undefined,
    }) as Record<string, unknown>;
    expect(scan([{ instance: orphan }])[0]?.provider).toBe('Unknown');
  });

  it('breaks an event-name tie on the provider, then on the method', () => {
    class Alpha {
      @OnEvent('same.event')
      handleB(): void {}

      @OnEvent('same.event')
      handleA(): void {}
    }
    class Beta {
      @OnEvent('same.event')
      handle(): void {}
    }

    const listeners = scan([{ instance: new Beta() }, { instance: new Alpha() }]);
    expect(listeners.map((l) => `${l.provider}.${l.method}`)).toEqual([
      'Alpha.handleA',
      'Alpha.handleB',
      'Beta.handle',
    ]);
  });

  it('exposes the owning instance so the profiler can wrap the handler', () => {
    const instance = new ReviewController();
    expect(scan([{ instance }])[0]?.instance).toBe(instance);
  });
});
