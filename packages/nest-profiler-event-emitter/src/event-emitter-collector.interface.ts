import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions, InjectionToken } from '@nestjs/common';
import type { ProfilerErrorOptions, ProfilerTag, TagSeverity } from '@eleven-labs/nest-profiler';

/** Inline SVG shared by the Events panel, the `event` entrypoint and the Routes group. */
export const EVENT_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/><path d="M5.2 5.2a4 4 0 0 0 0 5.6M10.8 5.2a4 4 0 0 1 0 5.6M3 3a7 7 0 0 0 0 10M13 3a7 7 0 0 1 0 10"/></svg>`;

/** One captured `EventEmitter2` emission, rendered as a row in the Events panel. */
export interface EventEntry {
  /** The emitted event name, e.g. `review.created`. */
  event: string;
  /** Redacted and size-bounded; `undefined` when capture is off or nothing was emitted. */
  payload?: unknown;
  /** How many listeners were subscribed to the event at emit time. */
  listenerCount: number;
  /** Wall-clock ms: the synchronous dispatch for `emit`, every awaited handler for `emitAsync`. */
  duration: number;
  /** `true` when emitted through `emitAsync`, `false` for the fire-and-forget `emit`. */
  async: boolean;
  /** Epoch ms at emit entry; orders the timeline and feeds the "Time" column. */
  startedAt: number;
  /**
   * Message of an error thrown by `emit` or rejected by an awaited `emitAsync` handler.
   *
   * Rarely populated in practice: `@OnEvent` defaults to `suppressErrors: true`, so a throwing
   * handler is logged by `@nestjs/event-emitter` and never surfaces to the emitter. Subscribe
   * with `{ suppressErrors: false }` to see handler failures here.
   */
  error?: string;
  /** Grouping key for the N+1 rule — the event name, which is already parameter-free. */
  fingerprint?: string;
  /** Populated by the core performance-rule engine. */
  tags?: ProfilerTag[];
}

export interface EventEmitterCollectorModuleOptions {
  /** Capture the (redacted) payload. Default: `true` — turn off when payloads may hold PII. */
  capturePayload?: boolean;
  /** Max length of the stringified payload kept per event, to bound profile size. Default: `2000`. */
  maxPayloadLength?: number;
  /**
   * Event names never recorded. Strings match exactly; RegExps are tested against the name.
   * `newListener` / `removeListener` are always ignored on top of this.
   */
  ignoreEvents?: Array<string | RegExp>;
  /** DI token of the `EventEmitter2` to patch. Defaults to the class `EventEmitterModule` registers. */
  emitterToken?: InjectionToken;
  /**
   * Give each `@OnEvent` execution its own profile, with its own logs, queries and sub-requests.
   * Default: `true`. Set to `false` to keep the per-request Events panel only.
   */
  profileListeners?: boolean;
  /** An emission at or above this duration (ms) is tagged `slow`. Default: `100`. */
  slowThreshold?: number;
  /** This many identical event names or more in one profile tags it `n-plus-one`. Default: `2`. */
  nPlusOneThreshold?: number;
  /** At or above this many emissions in one profile, the profile is tagged `chatty`. Default: `20`. */
  chattyThreshold?: number;
  /** Severity of the `slow` tag on emissions. Default: `warning`. */
  slowSeverity?: TagSeverity;
  /**
   * What counts as a **failed listener execution** — what earns the `error` tag on an `event`
   * profile and what the list's `Errors` filter keeps. A handler has no status code of its own,
   * so the default verdict is simply "the handler threw".
   *
   * ```ts
   * // A handler that throws to signal a retry is not an incident; a timeout is.
   * EventEmitterCollectorModule.forRoot({ error: { exceptions: ['TimeoutError'] } });
   * ```
   */
  error?: ProfilerErrorOptions;
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;
}

/** Async configuration for `EventEmitterCollectorModule.forRootAsync`. */
export type EventEmitterCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<EventEmitterCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
  };

/** DI token for `EventEmitterCollectorModuleOptions`. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: EVENT_EMITTER_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<EventEmitterCollectorModuleOptions>()
    .setClassMethodName('forRoot')
    .build();
