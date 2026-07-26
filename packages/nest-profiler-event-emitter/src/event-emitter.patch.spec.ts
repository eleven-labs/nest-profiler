import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ModuleRef } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { PROFILER_CLS_KEYS } from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import { EVENT_EMITTER_EVENTS_KEY, EventEmitterPatch } from './event-emitter.patch';
import type {
  EventEmitterCollectorModuleOptions,
  EventEntry,
} from './event-emitter-collector.interface';

function makeProfile(): Profile {
  return {
    token: 'test',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

interface Harness {
  patch: EventEmitterPatch;
  emitter: EventEmitter2;
  profile: Profile;
  entries: () => EventEntry[];
}

/**
 * Wires the patch against a real `EventEmitter2` and a CLS stub that always exposes `profile`
 * (unless `withProfile` is false, standing in for "outside a profiled request").
 */
function setup(
  options: EventEmitterCollectorModuleOptions = {},
  { withProfile = true, withCls = true, emitterResolves = true } = {},
): Harness {
  const profile = makeProfile();
  const cls = {
    get: (key: string) => (key === PROFILER_CLS_KEYS.profile && withProfile ? profile : undefined),
  } as unknown as ClsService;
  const emitter = new EventEmitter2();

  const emitterToken = options.emitterToken ?? EventEmitter2;
  const moduleRef = {
    get: (token: unknown) => {
      if (token === ClsService) {
        if (!withCls) throw new Error('no cls');
        return cls;
      }
      if (token === emitterToken && emitterResolves) return emitter;
      throw new Error('not found');
    },
  } as unknown as ModuleRef;

  const patch = new EventEmitterPatch(moduleRef, options);
  patch.onModuleInit();

  return {
    patch,
    emitter,
    profile,
    entries: () => (profile.collectors[EVENT_EMITTER_EVENTS_KEY] as EventEntry[] | undefined) ?? [],
  };
}

describe('EventEmitterPatch', () => {
  describe('emit', () => {
    it('records a synchronous emission with its listener count and payload', () => {
      const { emitter, entries } = setup();
      emitter.on('review.created', () => {});

      emitter.emit('review.created', { id: 1 });

      expect(entries()).toHaveLength(1);
      expect(entries()[0]).toMatchObject({
        event: 'review.created',
        payload: { id: 1 },
        listenerCount: 1,
        async: false,
        fingerprint: 'review.created',
      });
      expect(entries()[0]?.duration).toBeGreaterThanOrEqual(0);
    });

    it('still returns the emitter verdict to the caller', () => {
      const { emitter } = setup();
      expect(emitter.emit('nobody.listens')).toBe(false);
      emitter.on('someone.listens', () => {});
      expect(emitter.emit('someone.listens')).toBe(true);
    });

    it('records an emission with no listener', () => {
      const { emitter, entries } = setup();
      emitter.emit('orphan.event');
      expect(entries()[0]).toMatchObject({ listenerCount: 0 });
    });

    it('joins a namespaced event array into a dotted name', () => {
      const { emitter, entries } = setup();
      emitter.emit(['review', 'created']);
      expect(entries()[0]?.event).toBe('review.created');
    });

    it('stringifies a non-string, non-array event name', () => {
      const { emitter, entries } = setup();
      emitter.emit(42 as unknown as string);
      expect(entries()[0]?.event).toBe('42');
    });

    it('keeps multiple emitted values as an array payload', () => {
      const { emitter, entries } = setup();
      emitter.emit('multi', 'a', 'b');
      expect(entries()[0]?.payload).toEqual(['a', 'b']);
    });

    it('leaves the payload undefined when nothing was emitted with the event', () => {
      const { emitter, entries } = setup();
      emitter.emit('bare');
      expect(entries()[0]?.payload).toBeUndefined();
    });

    it('records then rethrows when a listener throws', () => {
      const { emitter, entries } = setup();
      emitter.on('boom', () => {
        throw new Error('listener failed');
      });

      expect(() => emitter.emit('boom')).toThrow('listener failed');
      expect(entries()[0]).toMatchObject({ event: 'boom', error: 'listener failed' });
    });
  });

  describe('emitAsync', () => {
    it('records once the awaited handlers settle', async () => {
      const { emitter, entries } = setup();
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- emitAsync awaits the handler
      emitter.on('review.created', () => new Promise((r) => setTimeout(r, 5)));

      await emitter.emitAsync('review.created', { id: 1 });
      // The observer records out-of-band, on the microtask after the emitter's own promise.
      await Promise.resolve();

      expect(entries()[0]).toMatchObject({ event: 'review.created', async: true });
      expect(entries()[0]?.duration).toBeGreaterThanOrEqual(5);
    });

    it('records the rejection without swallowing it for the caller', async () => {
      const { emitter, entries } = setup();
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- emitAsync awaits the handler
      emitter.on('boom', () => Promise.reject(new Error('handler failed')));

      await expect(emitter.emitAsync('boom')).rejects.toThrow('handler failed');
      await Promise.resolve();

      expect(entries()[0]).toMatchObject({ event: 'boom', async: true, error: 'handler failed' });
    });
  });

  describe('error message extraction', () => {
    it('keeps a thrown string as the message', () => {
      const { emitter, entries } = setup();
      emitter.on('boom', () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercising the non-Error branch
        throw 'plain string failure';
      });

      expect(() => emitter.emit('boom')).toThrow();
      expect(entries()[0]?.error).toBe('plain string failure');
    });

    it('serialises a thrown plain object', () => {
      const { emitter, entries } = setup();
      emitter.on('boom', () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercising the non-Error branch
        throw { code: 42 };
      });

      expect(() => emitter.emit('boom')).toThrow();
      expect(entries()[0]?.error).toBe('{"code":42}');
    });

    it('falls back when the thrown value cannot be serialised', () => {
      const { emitter, entries } = setup();
      emitter.on('boom', () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercising the non-Error branch
        throw { big: 1n };
      });

      expect(() => emitter.emit('boom')).toThrow();
      expect(entries()[0]?.error).toBe('Unknown error');
    });

    it('falls back when the thrown value serialises to undefined', () => {
      const { emitter, entries } = setup();
      emitter.on('boom', () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercising the non-Error branch
        throw undefined;
      });

      expect(() => emitter.emit('boom')).toThrow();
      expect(entries()[0]?.error).toBe('Unknown error');
    });
  });

  it('records a zero listener count when the emitter cannot be introspected', () => {
    const { emitter, entries } = setup();
    jest.spyOn(emitter, 'listeners').mockImplementation(() => {
      throw new Error('introspection failed');
    });

    emitter.emit('review.created');
    expect(entries()[0]).toMatchObject({ listenerCount: 0 });
  });

  describe('ignore rules', () => {
    it('never records EventEmitter2 subscription bookkeeping', () => {
      const { emitter, entries } = setup();
      emitter.on('newListener', () => {});
      emitter.on('anything', () => {});
      expect(entries().map((e) => e.event)).not.toContain('newListener');
    });

    it('applies the ignore rules to emitAsync too', async () => {
      const { emitter, entries } = setup({ ignoreEvents: ['noisy.event'] });
      await emitter.emitAsync('noisy.event');
      await Promise.resolve();
      expect(entries()).toEqual([]);
    });

    it('skips emitAsync entirely outside a profiled request', async () => {
      const { emitter, entries } = setup({}, { withProfile: false });
      await emitter.emitAsync('review.created');
      await Promise.resolve();
      expect(entries()).toEqual([]);
    });

    it('ignores an exact string match', () => {
      const { emitter, entries } = setup({ ignoreEvents: ['noisy.event'] });
      emitter.emit('noisy.event');
      emitter.emit('quiet.event');
      expect(entries().map((e) => e.event)).toEqual(['quiet.event']);
    });

    it('ignores a RegExp match', () => {
      const { emitter, entries } = setup({ ignoreEvents: [/^internal\./] });
      emitter.emit('internal.tick');
      emitter.emit('domain.tick');
      expect(entries().map((e) => e.event)).toEqual(['domain.tick']);
    });

    it('ignores every match of a global RegExp, not every other one', () => {
      // `.test()` advances `lastIndex` on a /g/ RegExp — without a reset the second call matches.
      const { emitter, entries } = setup({ ignoreEvents: [/noisy/g] });
      emitter.emit('noisy.one');
      emitter.emit('noisy.two');
      emitter.emit('noisy.three');
      expect(entries()).toEqual([]);
    });
  });

  describe('payload capture', () => {
    it('is skipped entirely when capturePayload is off', () => {
      const { emitter, entries } = setup({ capturePayload: false });
      emitter.emit('review.created', { id: 1 });
      expect(entries()[0]?.payload).toBeUndefined();
    });

    it('redacts sensitive keys', () => {
      const { emitter, entries } = setup();
      emitter.emit('user.created', { email: 'a@b.c', password: 'hunter2' });
      expect(entries()[0]?.payload).toMatchObject({ password: '[REDACTED]' });
    });

    it('truncates a payload above maxPayloadLength', () => {
      const { emitter, entries } = setup({ maxPayloadLength: 20 });
      emitter.emit('big', { value: 'x'.repeat(200) });

      const payload = entries()[0]?.payload;
      expect(typeof payload).toBe('string');
      expect(payload as string).toMatch(/… \(truncated, \d+ chars\)$/);
    });

    it('keeps a non-serialisable payload as-is rather than dropping the entry', () => {
      const { emitter, entries } = setup();
      const circular: Record<string, unknown> = { name: 'loop' };
      circular['self'] = circular;

      emitter.emit('circular', circular);
      expect(entries()).toHaveLength(1);
      expect(entries()[0]?.payload).toBeDefined();
    });
  });

  describe('degraded environments', () => {
    it('does nothing when there is no CLS service', () => {
      const { emitter, entries } = setup({}, { withCls: false });
      emitter.emit('review.created');
      expect(entries()).toEqual([]);
    });

    it('does nothing when the emission happens outside a profiled request', () => {
      const { emitter, entries } = setup({}, { withProfile: false });
      emitter.emit('review.created');
      expect(entries()).toEqual([]);
    });

    it('warns once when a configured emitter token cannot be resolved', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      setup({ emitterToken: 'MISSING_EMITTER' }, { emitterResolves: false });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('EventEmitter2 not found'));
      warn.mockRestore();
    });

    it('does not patch a token that resolves to something other than an emitter', () => {
      const notAnEmitter = { hello: 'world' };
      const moduleRef = {
        get: (token: unknown) => {
          if (token === ClsService) return {} as ClsService;
          if (token === 'WRONG_TOKEN') return notAnEmitter;
          throw new Error('not found');
        },
      } as unknown as ModuleRef;

      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const patch = new EventEmitterPatch(moduleRef, { emitterToken: 'WRONG_TOKEN' });
      expect(() => patch.onModuleInit()).not.toThrow();
      expect(notAnEmitter).toEqual({ hello: 'world' });
      warn.mockRestore();
    });

    it('stays quiet when the default emitter is simply absent', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      setup({}, { emitterResolves: false });
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('lifecycle', () => {
    it('never wraps the same emitter twice', () => {
      const { patch, emitter, entries } = setup();
      // A second init (re-init, a second collector module) must not double-record.
      patch.onModuleInit();

      emitter.emit('review.created');
      expect(entries()).toHaveLength(1);
    });

    it('restores the original emit functions on destroy', () => {
      const { patch, emitter, entries } = setup();
      patch.onModuleDestroy();

      emitter.emit('review.created');
      expect(entries()).toEqual([]);
    });

    it('is safe to destroy an emitter-less patch', () => {
      const { patch } = setup({}, { withCls: false });
      expect(() => patch.onModuleDestroy()).not.toThrow();
    });
  });
});
