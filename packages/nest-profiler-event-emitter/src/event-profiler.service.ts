import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, ModuleRef, Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import {
  ProfilerCoreService,
  analyzeProfile,
  redact,
  tryResolve,
} from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import { EVENT_EMITTER_COLLECTOR_OPTIONS } from './event-emitter-collector.interface';
import type { EventEmitterCollectorModuleOptions } from './event-emitter-collector.interface';
import { EVENT_ENTRYPOINT_TYPE, buildEventEntrypointType } from './event-entrypoint';
import type { EventEntrypointData } from './event-entrypoint';
import { scanEventListeners } from './event-listener-scan';
import type { DiscoveredListener } from './event-listener-scan';

/** Metadata identifying which subscription a wrapped handler serves, captured at wrap time. */
interface ListenerMeta {
  event: string;
  provider: string;
  method: string;
}

type Handler = (...args: unknown[]) => unknown;
/** A handler wrapped by the profiler, tagged so it is never wrapped twice. */
type WrappedHandler = Handler & { __profilerWrapped?: boolean };

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

    for (const listener of scanEventListeners(
      this.discovery,
      this.metadataScanner,
      this.reflector,
    )) {
      this.wrapListener(listener);
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
    return {
      token: randomUUID(),
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
  }

  private finalize(profile: Profile<EventEntrypointData>, error: Error | undefined): void {
    profile.performance.duration = Date.now() - profile.performance.startTime;
    profile.response = { statusCode: error ? 500 : 200, headers: {}, body: undefined };
    profile.entrypoint.data.success = !error;
    if (error) {
      profile.exceptions.push({
        name: error.name,
        message: error.message,
        stack: error.stack,
        timestamp: Date.now(),
      });
    }
  }

  private wrapListener(listener: DiscoveredListener): void {
    const { instance, method } = listener;
    const current = instance[method] as WrappedHandler | undefined;
    if (typeof current !== 'function' || current.__profilerWrapped) return;

    const original = current.bind(instance) as Handler;
    const meta: ListenerMeta = {
      event: listener.event,
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
    return { ...parent, profiler: { ...parentProfiler, token: profile.token, profile } };
  }

  private async profile(
    meta: ListenerMeta,
    args: unknown[],
    exec: () => unknown,
  ): Promise<unknown> {
    const cls = this.cls;
    const core = this.core;
    if (!cls || !core) return exec();

    const profile = this.buildProfile(meta, args);
    let result: unknown;
    let error: Error | undefined;

    await cls.runWith(this.buildClsStore(cls, profile), async () => {
      try {
        result = await exec();
      } catch (err) {
        error = err instanceof Error ? err : new Error(String(err));
      }
      this.finalize(profile, error);
      // Persistence must never fail the handler or replace its own error: swallow + log
      // collect/storage failures so `if (error) throw error` below always wins.
      try {
        await core.collectorRegistry.collectAll(profile);
        // Mirrors the core's own persist pipeline so an event profile carries its tags too.
        const entrypointType = core.getEntrypointType(profile.entrypoint.type);
        analyzeProfile(
          profile,
          core.collectorRegistry.getCollectors(),
          core.getPerformanceRules(),
          {
            isError: entrypointType.isError?.bind(entrypointType),
            severity: entrypointType.errorSeverity,
          },
        );
        await core.storage.save(profile);
      } catch (persistErr) {
        const message = persistErr instanceof Error ? persistErr.message : String(persistErr);
        this.logger.warn(`Failed to persist event profile: ${message}`);
      }
    });

    // Re-throw so @nestjs/event-emitter's own try/catch (and emitAsync callers) see the error.
    if (error) throw error;
    return result;
  }
}
