import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ClsService } from 'nestjs-cls';
import {
  PROFILER_CLS_KEYS,
  appendCollectorEntry,
  redact,
  tryResolve,
} from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import { EVENT_EMITTER_COLLECTOR_OPTIONS } from './event-emitter-collector.interface';
import type {
  EventEmitterCollectorModuleOptions,
  EventEntry,
} from './event-emitter-collector.interface';

/** Key the raw per-request emissions are appended under; the collector reads and clears it. */
export const EVENT_EMITTER_EVENTS_KEY = '__event_emitter_events';

/** Fired by EventEmitter2 on listener (un)subscription — never a domain emission. */
const INTERNAL_EVENTS = new Set(['newListener', 'removeListener']);

/** A patched emit function tagged so a target is never wrapped twice. */
type EmitFn = (...args: unknown[]) => unknown;
type PatchedEmit = EmitFn & { __profilerPatched?: boolean };

/** The subset of `EventEmitter2` this patch reads/wraps (typed to avoid `any` access). */
interface PatchableEmitter {
  emit: PatchedEmit;
  emitAsync: PatchedEmit;
  listeners(event: unknown): unknown[];
}

/** Whether a resolved provider really is an emitter — a mistyped `emitterToken` resolves to
 *  whatever else is bound to it, and patching that would crash bootstrap. */
function isPatchableEmitter(value: unknown): value is PatchableEmitter {
  const candidate = value as Partial<PatchableEmitter> | null | undefined;
  return (
    typeof candidate?.emit === 'function' &&
    typeof candidate.emitAsync === 'function' &&
    typeof candidate.listeners === 'function'
  );
}

function eventName(event: unknown): string {
  if (typeof event === 'string') return event;
  if (Array.isArray(event)) return event.join('.');
  return String(event);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? 'Unknown error';
  } catch {
    return 'Unknown error';
  }
}

/**
 * Captures every event dispatched through the app's `EventEmitter2` for the duration of a request.
 *
 * The `Profile` is read **synchronously at emit entry**, the one point where the request's
 * `nestjs-cls` context is guaranteed active.
 *
 * `ClsService` and the emitter are resolved lazily via `ModuleRef`: an `@Optional()` dependency does
 * not traverse to the core's global ClsModule from a dynamic feature module, and the emitter lives in
 * the host's globally-registered `EventEmitterModule`. Either one missing ⇒ the patch no-ops.
 */
@Injectable()
export class EventEmitterPatch implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventEmitterPatch.name);
  /** Resolved lazily so a disabled core (no ClsModule) degrades to a no-op instead of a DI crash. */
  private cls: ClsService | undefined;
  /** Restores installed to undo the monkey-patch on shutdown (avoids leaking into e2e teardown). */
  private readonly restorers: (() => void)[] = [];
  private emitter: PatchableEmitter | undefined;

  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(EVENT_EMITTER_COLLECTOR_OPTIONS)
    private readonly options: EventEmitterCollectorModuleOptions = {},
  ) {}

  onModuleInit(): void {
    this.cls = tryResolve<ClsService>(this.moduleRef, ClsService);
    if (!this.cls) return;

    const resolved = tryResolve<unknown>(
      this.moduleRef,
      this.options.emitterToken ?? EventEmitter2,
    );
    if (!isPatchableEmitter(resolved)) {
      if (this.options.emitterToken) {
        this.logger.warn(
          'EventEmitter2 not found for the configured token — events will not be profiled.',
        );
      }
      return;
    }
    const emitter = resolved;

    this.emitter = emitter;
    this.patchEmit(emitter);
    this.patchEmitAsync(emitter);
  }

  onModuleDestroy(): void {
    // Restore the original methods so a torn-down ClsService isn't captured by lingering closures
    // (matters in e2e suites that create and destroy multiple apps against one emitter).
    for (const restore of this.restorers.splice(0)) restore();
    this.emitter = undefined;
  }

  private buildPayload(values: unknown[]): unknown {
    if (this.options.capturePayload === false) return undefined;
    if (values.length === 0) return undefined;
    // A single value (the common `emit(event, payload)` shape) is unwrapped; multiple stay an array.
    const raw = values.length === 1 ? values[0] : values;
    const redacted = redact(raw);
    const max = this.options.maxPayloadLength ?? 2000;
    try {
      const json = JSON.stringify(redacted);
      if (typeof json === 'string' && json.length > max) {
        return `${json.slice(0, max)}… (truncated, ${json.length} chars)`;
      }
    } catch {
      // Non-serialisable payload (circular, BigInt…) — keep the redacted value as-is.
    }
    return redacted;
  }

  private countListeners(emitter: PatchableEmitter, event: unknown): number {
    try {
      const listeners = emitter.listeners(event);
      return Array.isArray(listeners) ? listeners.length : 0;
    } catch {
      return 0;
    }
  }

  private record(profile: Profile, entry: EventEntry): void {
    try {
      appendCollectorEntry<EventEntry>(profile, EVENT_EMITTER_EVENTS_KEY, entry);
    } catch {
      // Never let profiling break an emission.
    }
  }

  private shouldIgnore(name: string): boolean {
    if (INTERNAL_EVENTS.has(name)) return true;
    return (this.options.ignoreEvents ?? []).some((rule) => {
      if (typeof rule === 'string') return rule === name;
      // `.test()` advances `lastIndex` on a /g|y/ RegExp, so a shared instance would match every
      // other call. Reset before testing rather than rejecting those flags.
      rule.lastIndex = 0;
      return rule.test(name);
    });
  }

  /**
   * Wraps `emit` (fire-and-forget). `original` is pre-bound to the emitter, so the arrow keeps `this`
   * as the patch instance while EventEmitter2 still runs against itself.
   */
  private patchEmit(emitter: PatchableEmitter): void {
    if (emitter.emit.__profilerPatched) return;
    const previous = emitter.emit;
    const original = emitter.emit.bind(emitter) as EmitFn;

    const patched = ((event: unknown, ...values: unknown[]): unknown => {
      const name = eventName(event);
      const profile = this.cls?.get<Profile | undefined>(PROFILER_CLS_KEYS.profile);
      if (!profile || this.shouldIgnore(name)) {
        return original(event, ...values);
      }
      const startedAt = Date.now();
      const listenerCount = this.countListeners(emitter, event);
      const payload = this.buildPayload(values);
      try {
        const result = original(event, ...values);
        this.record(profile, {
          event: name,
          payload,
          listenerCount,
          duration: Date.now() - startedAt,
          async: false,
          startedAt,
          fingerprint: name,
        });
        return result;
      } catch (error) {
        this.record(profile, {
          event: name,
          payload,
          listenerCount,
          duration: Date.now() - startedAt,
          async: false,
          startedAt,
          fingerprint: name,
          error: toErrorMessage(error),
        });
        throw error;
      }
    }) as PatchedEmit;

    patched.__profilerPatched = true;
    emitter.emit = patched;
    this.restorers.push(() => {
      emitter.emit = previous;
    });
  }

  /**
   * Wraps `emitAsync`. The awaited handlers are timed by observing the returned promise out-of-band:
   * the caller still gets the original promise untouched, and `.catch(() => {})` keeps our observer
   * from surfacing an unhandled rejection.
   */
  private patchEmitAsync(emitter: PatchableEmitter): void {
    if (emitter.emitAsync.__profilerPatched) return;
    const previous = emitter.emitAsync;
    const original = emitter.emitAsync.bind(emitter) as EmitFn;

    const patched = ((event: unknown, ...values: unknown[]): unknown => {
      const name = eventName(event);
      const profile = this.cls?.get<Profile | undefined>(PROFILER_CLS_KEYS.profile);
      if (!profile || this.shouldIgnore(name)) {
        return original(event, ...values);
      }
      const startedAt = Date.now();
      const listenerCount = this.countListeners(emitter, event);
      const payload = this.buildPayload(values);
      const result = original(event, ...values);

      Promise.resolve(result as PromiseLike<unknown>)
        .then(
          () =>
            this.record(profile, {
              event: name,
              payload,
              listenerCount,
              duration: Date.now() - startedAt,
              async: true,
              startedAt,
              fingerprint: name,
            }),
          (error: unknown) =>
            this.record(profile, {
              event: name,
              payload,
              listenerCount,
              duration: Date.now() - startedAt,
              async: true,
              startedAt,
              fingerprint: name,
              error: toErrorMessage(error),
            }),
        )
        .catch(() => {});

      return result;
    }) as PatchedEmit;

    patched.__profilerPatched = true;
    emitter.emitAsync = patched;
    this.restorers.push(() => {
      emitter.emitAsync = previous;
    });
  }
}
