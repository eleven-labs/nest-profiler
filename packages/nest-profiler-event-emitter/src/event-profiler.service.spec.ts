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

  @OnEvent('review.synced')
  async onSynced(): Promise<string> {
    await Promise.resolve();
    return 'synced';
  }
}

/** Minimal CLS stub: `runWith` swaps the active store, `get()` returns it. */
function makeCls(): ClsService {
  let store: Record<string, unknown> | undefined;
  return {
    isActive: () => store !== undefined,
    // Resolves a dotted path like nestjs-cls does, so the core's `profiler.traceId` accessor
    // reads the same store the profiler writes.
    get: (key?: string) =>
      key === undefined
        ? store
        : key
            .split('.')
            .reduce<unknown>(
              (node, part) => (node as Record<string, unknown> | undefined)?.[part],
              store,
            ),
    // Transparent, like the real `runWith<T>(store, cb: () => T): T` — it must not turn a
    // synchronous handler's return value into a promise, which is the very thing under test.
    runWith: (next: Record<string, unknown>, fn: () => unknown) => {
      const previous = store;
      store = next;
      try {
        const result = fn();
        if (result instanceof Promise) {
          return result.finally(() => {
            store = previous;
          });
        }
        store = previous;
        return result;
      } catch (err) {
        store = previous;
        throw err;
      }
    },
  } as unknown as ClsService;
}

/**
 * Awaits a handler call whatever its shape. The wrapper preserves the handler's own
 * synchronicity, so a sync handler throws synchronously here and an async one rejects.
 */
function call(fn: () => unknown): Promise<unknown> {
  return Promise.resolve().then(() => fn());
}

function setup(options?: EventEmitterCollectorModuleOptions, { withCore = true } = {}) {
  return setupWith(new ReviewListener(), options, { withCore });
}

/** The same harness against an arbitrary listener instance. */
function setupWith<T extends object>(
  listener: T,
  options?: EventEmitterCollectorModuleOptions,
  { withCore = true } = {},
) {
  const saved: Profile<EventEntrypointData>[] = [];
  const cls = makeCls();

  const registerEntrypointType = jest.fn();
  const collectAll = jest.fn((_profile: Profile<EventEntrypointData>) => Promise.resolve());
  const save = jest.fn((p: Profile<EventEntrypointData>) => {
    saved.push(p);
    return Promise.resolve();
  });

  /**
   * Stands in for `ProfilerCoreService.persist`: the profiler goes through the core's own
   * pipeline rather than calling `collectAll`/`save` itself, so that is what the stub models.
   */
  const persist = jest.fn(async (profile: Profile<EventEntrypointData>) => {
    await collectAll(profile);
    await save(profile);
  });
  /** Deferred counterpart, tracked here so a test can await it like `flushPendingProfiles` does. */
  const pending = new Set<Promise<unknown>>();
  const schedulePersist = jest.fn((profile: Profile<EventEntrypointData>) => {
    const work = persist(profile).catch(() => undefined);
    pending.add(work);
    void work.finally(() => pending.delete(work));
  });
  const flush = async (): Promise<void> => {
    while (pending.size > 0) await Promise.all([...pending]);
  };

  const core = {
    registerEntrypointType,
    getEntrypointType: jest.fn(() => ({ isError: () => false, errorSeverity: 'danger' })),
    getPerformanceRules: jest.fn(() => []),
    collectorRegistry: { collectAll, getCollectors: jest.fn(() => []) },
    storage: { save },
    persist,
    schedulePersist,
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

  return {
    service,
    listener,
    cls,
    saved,
    registerEntrypointType,
    collectAll,
    save,
    persist,
    flush,
  };
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

  it("adopts the emitter's trace id, so the handler joins the caller's trace", async () => {
    const { service, listener, cls, saved } = setup();
    service.onApplicationBootstrap();

    let insideTraceId: unknown;
    listener.probe = () => {
      insideTraceId = cls.get('profiler.traceId');
    };

    await cls.runWith({ profiler: { token: 'parent', traceId: 'trace-parent' } } as never, () =>
      call(() => listener.onCreated()),
    );

    expect(saved[0]?.traceId).toBe('trace-parent');
    // The handler's own branch carries the same id, so its logs correlate with the emitter's.
    expect(insideTraceId).toBe('trace-parent');
  });

  it('starts a trace of its own when nothing upstream was profiled', async () => {
    const { service, listener, saved } = setup();
    service.onApplicationBootstrap();

    await call(() => listener.onCreated());
    expect(saved[0]?.traceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('still calls the original handler with its arguments', async () => {
    const { service, listener } = setup();
    service.onApplicationBootstrap();

    await call(() => listener.onCreated('a', 'b'));
    expect(listener.calls).toEqual([['a', 'b']]);
  });

  it('records the failure, then rethrows so the emitter sees it', async () => {
    const { service, listener, saved, flush } = setup();
    service.onApplicationBootstrap();

    // Synchronously, exactly as the unwrapped handler did: `emit()` discards a listener's return
    // value, so a promise here would strand the rejection and lose the failure.
    expect(() => listener.onFailed()).toThrow('handler exploded');
    await flush();

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

  it('keeps a sync handler result when persistence fails', async () => {
    const { service, listener, save, flush } = setup();
    service.onApplicationBootstrap();
    save.mockRejectedValueOnce(new Error('disk full'));

    // The sync path defers through `core.schedulePersist`, which never rejects and reports the
    // failure itself — the handler must be unaffected either way.
    expect(listener.onCreated()).toBe('done');
    await expect(flush()).resolves.toBeUndefined();
  });

  it('logs but swallows a persistence failure on the awaited path', async () => {
    const { service, listener, save } = setup();
    service.onApplicationBootstrap();
    save.mockRejectedValueOnce(new Error('disk full'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await expect(listener.onSynced()).resolves.toBe('synced');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    warn.mockRestore();
  });

  it('keeps an async handler asynchronous and persists before it settles', async () => {
    const { service, listener, saved } = setup();
    service.onApplicationBootstrap();

    const pending = listener.onSynced();
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).resolves.toBe('synced');
    expect(saved.map((p) => p.entrypoint.data.event)).toContain('review.synced');
  });

  it('keeps a sync handler synchronous', () => {
    const { service, listener } = setup();
    service.onApplicationBootstrap();

    // Not a promise: `emit()` discards a listener's return value, so an async wrapper would
    // strand a thrown error as an unhandled rejection.
    expect(listener.onCreated()).toBe('done');
  });

  it('lets the handler error win over a persistence failure', async () => {
    const { service, listener, save, flush } = setup();
    service.onApplicationBootstrap();
    save.mockRejectedValueOnce(new Error('disk full'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    expect(() => listener.onFailed()).toThrow('handler exploded');
    await flush();
    warn.mockRestore();
  });

  it('names every event a multi-@OnEvent handler serves, not just the first', async () => {
    class MultiListener {
      @OnEvent('review.archived')
      @OnEvent('review.deleted')
      onGone(): string {
        return 'gone';
      }
    }
    const listener = new MultiListener();
    const { service, saved, flush } = setupWith(listener);
    service.onApplicationBootstrap();

    listener.onGone();
    await flush();

    // The loader registers `(...args) => instance[method](...args)`, so the handler is never told
    // which subscription fired. Reporting only the alphabetically-first one mislabelled every
    // profile produced by the others.
    expect(saved[0]?.entrypoint.data.event).toBe('review.archived, review.deleted');
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
