import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, ModuleRef, Reflector } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ClsService } from 'nestjs-cls';
import {
  ProfilerCoreService,
  completeProfilePerformance,
  markProfileStart,
  readTraceId,
  redact,
  toExceptionEntry,
  tryResolve,
} from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import { EVENT_EMITTER_COLLECTOR_OPTIONS } from './event-emitter-collector.interface';
import type { EventEmitterCollectorModuleOptions } from './event-emitter-collector.interface';
import { EVENT_ENTRYPOINT_TYPE, buildEventEntrypointType } from './event-entrypoint';
import type { EventEntrypointData } from './event-entrypoint';
import { emitterDelimiter, scanEventListeners } from './event-listener-scan';
import type { DiscoveredListener } from './event-listener-scan';

/** Metadata identifying which subscription a wrapped handler serves, captured at wrap time. */
interface ListenerMeta {
  /**
   * What the profile is filed under. One `@OnEvent` means the event name; a method carrying
   * several means all of them, joined.
   *
   * A method subscribed to more than one event cannot report which one fired: the loader in
   * `@nestjs/event-emitter` registers `(...args) => instance[method](...args)`, so the handler
   * receives the payload and nothing else. Naming all of them is the only honest answer —
   * naming the first would silently mislabel every profile produced by the others.
   */
  event: string;
  provider: string;
  method: string;
}

type Handler = (...args: unknown[]) => unknown;
/** A handler wrapped by the profiler, tagged so it is never wrapped twice. */
type WrappedHandler = Handler & { __profilerWrapped?: boolean };

/** Narrows a handler's return value to something that must be awaited. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

/** A thrown value as an `Error`, so the exception entry always has a name and a message. */
function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Groups discovered subscriptions by the handler they point at, keyed by the owning instance and
 * the method name — the unit the profiler actually wraps.
 */
function groupByHandler(listeners: DiscoveredListener[]): Map<string, DiscoveredListener[]> {
  const byHandler = new Map<object, Map<string, DiscoveredListener[]>>();
  const grouped = new Map<string, DiscoveredListener[]>();

  for (const listener of listeners) {
    const perInstance = byHandler.get(listener.instance) ?? new Map<string, DiscoveredListener[]>();
    byHandler.set(listener.instance, perInstance);

    const existing = perInstance.get(listener.method);
    if (existing) {
      existing.push(listener);
      continue;
    }
    const subscriptions = [listener];
    perInstance.set(listener.method, subscriptions);
    // Instances are distinct objects, so the provider/method pair is unique per group here.
    grouped.set(`${listener.provider}.${listener.method}#${grouped.size}`, subscriptions);
  }

  return grouped;
}

/**
 * Turns every `@OnEvent` handler execution into its own `event` profile, carrying the logs, SQL
 * queries and outbound HTTP calls that run inside it — the way the commander package profiles CLI
 * commands. The emitting request keeps its own profile, whose "Events" panel lists what it emitted.
 *
 * Each handler method is replaced on its owning instance by a wrapper delegating to the original.
 * No core or no `ClsService` (profiling disabled) ⇒ handlers are left untouched.
 */
@Injectable()
export class EventProfilerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EventProfilerService.name);
  private cls: ClsService | undefined;
  private core: ProfilerCoreService | undefined;
  /** Restores installed to unwrap the handlers on shutdown (avoids leaking into e2e teardown). */
  private readonly restorers: (() => void)[] = [];

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
    @Optional()
    @Inject(EVENT_EMITTER_COLLECTOR_OPTIONS)
    private readonly options: EventEmitterCollectorModuleOptions = {},
  ) {}

  onApplicationBootstrap(): void {
    if (this.options.profileListeners === false) return;

    this.cls = tryResolve<ClsService>(this.moduleRef, ClsService);
    this.core = tryResolve<ProfilerCoreService>(this.moduleRef, ProfilerCoreService);
    // No core or no CLS ⇒ profiling is disabled for this process; leave handlers untouched.
    if (!this.cls || !this.core) return;

    this.core.registerEntrypointType(buildEventEntrypointType(this.options.error));

    // Grouped by handler method, because a method may carry several `@OnEvent` decorators and is
    // wrapped exactly once — the wrapper has to know every event it serves, not just the first
    // one discovery happened to yield.
    for (const [, subscriptions] of groupByHandler(
      scanEventListeners(
        this.discovery,
        this.metadataScanner,
        this.reflector,
        // The host may configure another delimiter; an array-form `@OnEvent` is joined with it.
        emitterDelimiter(tryResolve(this.moduleRef, EventEmitter2)),
      ),
    )) {
      this.wrapListener(subscriptions);
    }
  }

  onModuleDestroy(): void {
    // Put the original handlers back so a torn-down ClsService/core isn't captured by lingering
    // closures (matters in e2e suites that create and destroy multiple apps).
    for (const restore of this.restorers.splice(0)) restore();
  }

  private buildProfile(meta: ListenerMeta, args: unknown[]): Profile<EventEntrypointData> {
    const startTime = Date.now();
    const capturePayload = this.options.capturePayload !== false;
    const payload =
      capturePayload && args.length > 0 ? redact(args.length === 1 ? args[0] : args) : undefined;
    const profile: Profile<EventEntrypointData> = {
      token: randomUUID(),
      // The handler continues the emitter's trace when the emission happened inside a profiled
      // execution — a listener is the same unit of work seen further down; a handler fired outside
      // one (a bootstrap or scheduled emission) starts a trace of its own.
      traceId: readTraceId(this.cls) ?? randomUUID(),
      createdAt: startTime,
      entrypoint: {
        type: EVENT_ENTRYPOINT_TYPE,
        data: {
          event: meta.event,
          provider: meta.provider,
          method: meta.method,
          payload,
          success: true,
        },
      },
      performance: { startTime, heapUsed: process.memoryUsage().heapUsed },
      logs: [],
      exceptions: [],
      collectors: {},
    };
    // What `finalize` measures the handler against — the monotonic clock, not `startTime` — plus
    // the cpu, memory and event-loop baselines its Performance tab is differenced from.
    markProfileStart(profile);
    return profile;
  }

  private finalize(profile: Profile<EventEntrypointData>, error: Error | undefined): void {
    completeProfilePerformance(profile);
    profile.response = { statusCode: error ? 500 : 200, headers: {}, body: undefined };
    profile.entrypoint.data.success = !error;
    if (error) {
      // Same stack settings as the HTTP and command paths — resolved once by the core — so a
      // handler's frames get the grouping and the code excerpt the options promise everywhere.
      profile.exceptions.push(toExceptionEntry(error, this.core?.exceptionCapture ?? {}));
    }
  }

  private wrapListener(subscriptions: DiscoveredListener[]): void {
    const [listener] = subscriptions;
    if (!listener) return;
    const { instance, method } = listener;
    const current = instance[method] as WrappedHandler | undefined;
    if (typeof current !== 'function' || current.__profilerWrapped) return;

    const original = current.bind(instance) as Handler;
    const events = subscriptions.map((subscription) => subscription.event);
    const meta: ListenerMeta = {
      event: events.length === 1 ? (events[0] as string) : events.join(', '),
      provider: listener.provider,
      method: listener.method,
    };

    const wrapped: WrappedHandler = (...args: unknown[]): unknown =>
      this.profile(meta, args, () => original(...args));
    wrapped.__profilerWrapped = true;

    // Carry every metadata key — `EVENT_LISTENER_METADATA` above all — onto the wrapper, so
    // @nestjs/event-emitter's loader still recognises it as a listener even if it scans after
    // this wrapping ran.
    for (const key of Reflect.getMetadataKeys(current) as unknown[]) {
      Reflect.defineMetadata(key, Reflect.getMetadata(key, current), wrapped);
    }

    instance[method] = wrapped;
    this.restorers.push(() => {
      instance[method] = current;
    });
  }

  /**
   * The `profiler` branch must be a fresh object, hence `runWith` over `run` + `set`: `cls.run`
   * copies the parent context shallowly and `cls.set` writes through a path, so a shared branch
   * would replace the emitting request's own profile. Other parent keys stay inherited.
   */
  private buildClsStore(
    cls: ClsService,
    profile: Profile<EventEntrypointData>,
  ): Record<string, unknown> {
    const parent = cls.isActive() ? (cls.get() as Record<string, unknown> | undefined) : undefined;
    const parentProfiler = parent?.profiler as Record<string, unknown> | undefined;
    return {
      ...parent,
      profiler: {
        ...parentProfiler,
        token: profile.token,
        traceId: profile.traceId,
        profile,
      },
    };
  }

  /**
   * Runs one handler inside its own profile, **preserving the handler's own synchronicity**.
   *
   * A synchronous handler must stay synchronous. `@nestjs/event-emitter` registers the method
   * directly, and `emit()` is fire-and-forget: it discards whatever a listener returns. So a
   * wrapper that always returned a promise turned a synchronous `throw` into a rejected promise
   * nobody consumes — the emitter's own `try`/`catch` never saw it (a handler failure went
   * missing from the emitting profile's Events panel, contradicting what `suppressErrors: false`
   * promises), and Node terminated the process on the unhandled rejection.
   *
   * The asynchronous path is unchanged: the profile is persisted before the returned promise
   * settles, so `emitAsync` callers still observe a stored profile once they have awaited.
   */
  private profile(meta: ListenerMeta, args: unknown[], exec: () => unknown): unknown {
    const cls = this.cls;
    const core = this.core;
    if (!cls || !core) return exec();

    const profile = this.buildProfile(meta, args);

    return cls.runWith(this.buildClsStore(cls, profile), () => {
      let result: unknown;
      try {
        result = exec();
      } catch (err) {
        this.finalize(profile, asError(err));
        // Deferred but tracked, so `flushPendingProfiles()` still drains it in tests.
        core.schedulePersist(profile);
        throw err;
      }

      if (!isThenable(result)) {
        this.finalize(profile, undefined);
        core.schedulePersist(profile);
        return result;
      }

      return Promise.resolve(result).then(
        async (value) => {
          this.finalize(profile, undefined);
          await this.persist(core, profile);
          return value;
        },
        async (err: unknown) => {
          this.finalize(profile, asError(err));
          await this.persist(core, profile);
          throw err;
        },
      );
    });
  }

  /**
   * Runs the core's own collect/analyze/trace/save pipeline. Going through {@link
   * ProfilerCoreService.persist} rather than calling `collectAll` and `storage.save` by hand is
   * what keeps an event profile equal to every other kind: the hand-rolled version skipped the
   * version stamp and the trace assembly, so an event profile reached storage with an empty
   * waterfall.
   *
   * Persistence must never fail the handler nor replace its error, so failures are logged here.
   */
  private async persist(core: ProfilerCoreService, profile: Profile): Promise<void> {
    try {
      await core.persist(profile);
    } catch (err) {
      this.logger.warn(`Failed to persist event profile: ${asError(err).message}`);
    }
  }
}
