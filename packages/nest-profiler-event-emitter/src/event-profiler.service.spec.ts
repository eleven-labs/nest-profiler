import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, ModuleRef, Reflector } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import { ClsService } from 'nestjs-cls';
import { ProfilerCoreService } from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import { EventProfilerService } from './event-profiler.service';
import { EVENT_ENTRYPOINT_TYPE } from './event-entrypoint';
import type { EventEntrypointData } from './event-entrypoint';
import type { EventEmitterCollectorModuleOptions } from './event-emitter-collector.interface';

class ReviewListener {
  calls: unknown[][] = [];
  /** Runs inside the handler, i.e. inside the CLS branch the profiler created. */
  probe?: () => void;

  @OnEvent('review.created')
  onCreated(...args: unknown[]): string {
    this.calls.push(args);
    this.probe?.();
    return 'done';
  }

  @OnEvent('review.failed')
  onFailed(): never {
    throw new Error('handler exploded');
  }
}

/** Minimal CLS stub: `runWith` swaps the active store, `get()` returns it. */
function makeCls(): ClsService {
  let store: Record<string, unknown> | undefined;
  return {
    isActive: () => store !== undefined,
    get: (key?: string) => (key === undefined ? store : undefined),
    runWith: (next: Record<string, unknown>, fn: () => unknown) => {
      const previous = store;
      store = next;
      return Promise.resolve(fn()).finally(() => {
        store = previous;
      });
    },
  } as unknown as ClsService;
}

/** A profiler-wrapped handler returns a promise even though its declared signature is sync. */
function call(fn: () => unknown): Promise<unknown> {
  return Promise.resolve(fn());
}

function setup(options?: EventEmitterCollectorModuleOptions, { withCore = true } = {}) {
  const listener = new ReviewListener();
  const saved: Profile<EventEntrypointData>[] = [];
  const cls = makeCls();

  const registerEntrypointType = jest.fn();
  const collectAll = jest.fn(() => Promise.resolve());
  const save = jest.fn((p: Profile<EventEntrypointData>) => {
    saved.push(p);
    return Promise.resolve();
  });

  const core = {
    registerEntrypointType,
    getEntrypointType: jest.fn(() => ({ isError: () => false, errorSeverity: 'danger' })),
    getPerformanceRules: jest.fn(() => []),
    collectorRegistry: { collectAll, getCollectors: jest.fn(() => []) },
    storage: { save },
  } as unknown as ProfilerCoreService;

  const moduleRef = {
    get: (token: unknown) => {
      if (token === ClsService) return cls;
      if (token === ProfilerCoreService) {
        if (!withCore) throw new Error('no core');
        return core;
      }
      throw new Error('not found');
    },
  } as unknown as ModuleRef;

  const discovery = {
    getProviders: () => [{ instance: listener }],
    getControllers: () => [],
  } as unknown as DiscoveryService;

  const service = new EventProfilerService(
    moduleRef,
    discovery,
    new MetadataScanner(),
    new Reflector(),
    options,
  );

  return { service, listener, cls, saved, registerEntrypointType, collectAll, save };
}

describe('EventProfilerService', () => {
  it('defaults its options when the token is not bound', async () => {
    const { service, listener, saved } = setup(undefined);
    service.onApplicationBootstrap();

    await call(() => listener.onCreated({ id: 1 }));
    expect(saved[0]?.entrypoint.data.payload).toEqual({ id: 1 });
  });

  it('registers the event entrypoint type at bootstrap', () => {
    const { service, registerEntrypointType } = setup();
    service.onApplicationBootstrap();

    expect(registerEntrypointType).toHaveBeenCalledWith(
      expect.objectContaining({ type: EVENT_ENTRYPOINT_TYPE }),
    );
  });

  it('passes the configured error classification to the entrypoint type', () => {
    const { service, registerEntrypointType } = setup({ error: { severity: 'warning' } });
    service.onApplicationBootstrap();

    expect(registerEntrypointType).toHaveBeenCalledWith(
      expect.objectContaining({ errorSeverity: 'warning' }),
    );
  });

  it('profiles a handler execution and persists it', async () => {
    const { service, listener, saved, collectAll } = setup();
    service.onApplicationBootstrap();

    await expect(call(() => listener.onCreated({ id: 1 }))).resolves.toBe('done');

    expect(collectAll).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      entrypoint: {
        type: 'event',
        data: {
          event: 'review.created',
          provider: 'ReviewListener',
          method: 'onCreated',
          payload: { id: 1 },
          success: true,
        },
      },
      response: { statusCode: 200 },
    });
    expect(saved[0]?.performance.duration).toBeGreaterThanOrEqual(0);
  });

  it('still calls the original handler with its arguments', async () => {
    const { service, listener } = setup();
    service.onApplicationBootstrap();

    await call(() => listener.onCreated('a', 'b'));
    expect(listener.calls).toEqual([['a', 'b']]);
  });

  it('records the failure, then rethrows so the emitter sees it', async () => {
    const { service, listener, saved } = setup();
    service.onApplicationBootstrap();

    await expect(call(() => listener.onFailed())).rejects.toThrow('handler exploded');

    expect(saved[0]).toMatchObject({
      entrypoint: { data: { success: false } },
      response: { statusCode: 500 },
    });
    expect(saved[0]?.exceptions[0]).toMatchObject({ message: 'handler exploded' });
  });

  it('redacts the captured payload', async () => {
    const { service, listener, saved } = setup();
    service.onApplicationBootstrap();

    await call(() => listener.onCreated({ password: 'hunter2' }));
    expect(saved[0]?.entrypoint.data.payload).toMatchObject({ password: '[REDACTED]' });
  });

  it('omits the payload when capture is off', async () => {
    const { service, listener, saved } = setup({ capturePayload: false });
    service.onApplicationBootstrap();

    await call(() => listener.onCreated({ id: 1 }));
    expect(saved[0]?.entrypoint.data.payload).toBeUndefined();
  });

  it('gives the handler a fresh profile branch instead of overwriting the parent one', async () => {
    const { service, listener, cls, saved } = setup();
    service.onApplicationBootstrap();

    const parentProfile = { token: 'parent' } as unknown as Profile;
    let seenInside: Record<string, unknown> | undefined;

    await cls.runWith(
      { profiler: { token: 'parent', profile: parentProfile }, tenant: 'acme' } as never,
      async () => {
        await call(() => listener.onCreated());
        seenInside = cls.get() as Record<string, unknown>;
      },
    );

    // The parent context is restored after the handler, and unrelated keys were inherited.
    expect((seenInside?.['profiler'] as Record<string, unknown>)['token']).toBe('parent');
    expect(saved[0]?.token).not.toBe('parent');
  });

  it('inherits unrelated CLS keys into the handler context and swaps in its own profile', async () => {
    const { service, listener, cls } = setup();
    service.onApplicationBootstrap();

    const parentProfile = { token: 'parent' } as unknown as Profile;
    let inside: Record<string, unknown> | undefined;
    listener.probe = () => {
      inside = cls.get() as Record<string, unknown>;
    };

    await cls.runWith(
      { profiler: { token: 'parent', profile: parentProfile }, tenant: 'acme' } as never,
      () => call(() => listener.onCreated()),
    );

    // The unrelated key is inherited…
    expect(inside?.['tenant']).toBe('acme');
    // …while the profiler branch points at the handler's own fresh profile.
    const profiler = inside?.['profiler'] as Record<string, unknown>;
    expect(profiler['token']).not.toBe('parent');
    expect((profiler['profile'] as Profile).entrypoint.type).toBe('event');
  });

  it('leaves handlers untouched when profileListeners is off', () => {
    const { service, listener, saved, registerEntrypointType } = setup({ profileListeners: false });
    service.onApplicationBootstrap();

    expect(registerEntrypointType).not.toHaveBeenCalled();
    expect(listener.onCreated()).toBe('done');
    expect(saved).toEqual([]);
  });

  it('leaves handlers untouched when the profiler core is unavailable', () => {
    const { service, listener, saved } = setup({}, { withCore: false });
    service.onApplicationBootstrap();

    expect(listener.onCreated()).toBe('done');
    expect(saved).toEqual([]);
  });

  it('never wraps the same handler twice', async () => {
    const { service, listener, saved } = setup();
    service.onApplicationBootstrap();
    service.onApplicationBootstrap();

    await call(() => listener.onCreated());
    expect(saved).toHaveLength(1);
  });

  it('logs but swallows a persistence failure so the handler result stands', async () => {
    const { service, listener, save } = setup();
    service.onApplicationBootstrap();
    save.mockRejectedValueOnce(new Error('disk full'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await expect(call(() => listener.onCreated())).resolves.toBe('done');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    warn.mockRestore();
  });

  it('lets the handler error win over a persistence failure', async () => {
    const { service, listener, save } = setup();
    service.onApplicationBootstrap();
    save.mockRejectedValueOnce(new Error('disk full'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await expect(call(() => listener.onFailed())).rejects.toThrow('handler exploded');
    warn.mockRestore();
  });

  it('carries the @OnEvent metadata onto the wrapper so the loader still sees it', () => {
    const { service, listener } = setup();
    service.onApplicationBootstrap();

    const wrapper = (listener as unknown as Record<string, unknown>)['onCreated'];
    expect(Reflect.getMetadata('EVENT_LISTENER_METADATA', wrapper as object)).toBeDefined();
  });

  it('restores the original handlers on destroy', () => {
    const { service, listener, saved } = setup();
    service.onApplicationBootstrap();
    service.onModuleDestroy();

    expect(listener.onCreated()).toBe('done');
    expect(saved).toEqual([]);
  });
});
