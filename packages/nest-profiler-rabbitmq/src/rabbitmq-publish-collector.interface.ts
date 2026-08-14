import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';
import type {
  EntryErrorOptions,
  ProfilerTag,
  SafeDataOptions,
  TagSeverity,
} from '@eleven-labs/nest-profiler';

/** One `AmqpConnection.publish(...)` call made while a profile was active. */
export interface AmqpPublishEntry {
  /** Exchange the message was published to (empty string for the default exchange). */
  exchange: string;
  /** Routing key the message was published with. */
  routingKey: string;
  /**
   * The published message, captured only when `captureBody` is enabled: the object handed to
   * `publish()`, or the decoded text of a `Buffer`/`Uint8Array` payload (parsed back to JSON
   * when it is JSON). Redacted and size-capped before being persisted.
   */
  payload?: unknown;
  /** Masked AMQP headers passed to `publish()`, when `captureHeaders` is enabled. */
  headers?: Record<string, string>;
  /** `messageId` publish option, when the caller set one. */
  messageId?: string;
  /** `appId` publish option, when the caller set one. */
  appId?: string;
  /** `correlationId` publish option — set by `AmqpConnection.request()` on RPC calls. */
  correlationId?: string;
  /** `replyTo` publish option — the reply queue of an RPC call. */
  replyTo?: string;
  /** Epoch ms at which the publish was issued. */
  startedAt: number;
  /** Time spent in `publish()`, in ms. */
  duration: number;
  /**
   * What `publish()` resolved to. `false` means the channel's write buffer was full: the
   * message is queued in the publisher, not lost — surfaced as `buffered` in the panel.
   */
  accepted?: boolean;
  /** Message of the error `publish()` rejected with, when it failed. */
  error?: string;
  /** Runnable amqplib `channel.publish(...)` snippet, precomputed for the UI copy button. */
  publishSnippet?: string;
  /**
   * Value-free key (exchange + routing key with id segments neutralized) used by the
   * performance-rule engine to group repeated publishes (the N+1 signal).
   */
  fingerprint?: string;
  /** Performance tags applied by the rule engine (slow, N+1, error…). */
  tags?: ProfilerTag[];
}

/** Private `profile.collectors` key where the patch accumulates raw publish entries. */
export const RABBITMQ_PUBLISHES_KEY = '__rabbitmq_publishes';

export interface RabbitMqPublishCollectorModuleOptions {
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;

  /**
   * Capture the AMQP headers passed to `publish()`. Default: `true`.
   * Sensitive headers are masked — see {@link maskHeaders}.
   */
  captureHeaders?: boolean;

  /**
   * Capture the published message. Default: `true`.
   * Disable it when messages carry payloads too large or too sensitive to store.
   */
  captureBody?: boolean;

  /**
   * Header names (lowercase) whose values are replaced with `[REDACTED]`.
   * Merged with the built-in list: `authorization`, `cookie`, `x-api-key`,
   * `x-auth-token`.
   */
  maskHeaders?: string[];

  /**
   * Depth / size caps applied to captured payloads, forwarded to the core's `toSafeData`.
   * Defaults to the core defaults (`maxDepth: 4`, `maxItems: 64`, `maxStringLength: 2048`).
   * Only meaningful when {@link RabbitMqPublishCollectorModuleOptions.captureBody} is enabled.
   */
  payloadLimits?: SafeDataOptions;

  /** A publish at or above this duration (ms) is tagged `slow`. Default: `50`. */
  slowThreshold?: number;

  /**
   * Identical publishes (same exchange + routing key, id segments neutralized) repeated at
   * least this many times in one profile are tagged `n-plus-one`. Default: `2`.
   */
  nPlusOneThreshold?: number;

  /** A profile publishing at least this many messages is tagged `chatty`. Default: `10`. */
  chattyThreshold?: number;

  /** Severity of the `slow` tag. Default: `warning`. */
  slowSeverity?: TagSeverity;
  /** Severity of the `n-plus-one` tag. Default: `danger`. */
  nPlusOneSeverity?: TagSeverity;
  /** Severity of the `chatty` tag. Default: `warning`. */
  chattySeverity?: TagSeverity;

  /**
   * What counts as a **failed publish** — what earns the `error` tag. A publish carries no
   * status code, so the default rests on `publish()` having rejected; a full write buffer
   * (`accepted: false`) is a warning, not a failure. Take over with `classify` when a broker
   * error is expected flow control.
   *
   * ```ts
   * // A publish that failed while the broker was reconnecting is not an incident here.
   * RabbitMqPublishCollectorModule.forRoot({
   *   error: {
   *     classify: (entry) => (entry.error?.includes('Channel closed') ? false : undefined),
   *   },
   * });
   * ```
   */
  error?: EntryErrorOptions;
}

/** Async configuration for `RabbitMqPublishCollectorModule.forRootAsync`. */
export type RabbitMqPublishCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<RabbitMqPublishCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
  };

/** DI token for `RabbitMqPublishCollectorModuleOptions`. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: RABBITMQ_PUBLISH_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<RabbitMqPublishCollectorModuleOptions>()
    .setClassMethodName('forRoot')
    .build();
