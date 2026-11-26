import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';
import type {
  CollectorModuleOptions,
  EntryErrorOptions,
  ProfilerTag,
  SafeDataOptions,
  TagSeverityOptions,
} from '@eleven-labs/nest-profiler';

/** One `Topic.publishMessage(...)` call made while a profile was active. */
export interface PubSubPublishEntry {
  /** Short id of the topic the message was published to (`orders`, not `projects/…/topics/orders`). */
  topic: string;
  /**
   * Google Cloud project the topic belongs to, when the client knew it at publish time. Absent
   * while the client still resolves its project id from the credentials.
   */
  projectId?: string;
  /**
   * The published message, captured only when `captureBody` is enabled: the `json` object handed
   * to `publishMessage()`, or the decoded text of its `data` buffer (parsed back to JSON when it
   * is JSON). Redacted and size-capped before being persisted.
   */
  payload?: unknown;
  /** Size of the published `data`, in bytes. */
  size?: number;
  /** Masked message attributes, when `captureAttributes` is enabled. */
  attributes?: Record<string, string>;
  /** Ordering key of the message, when the publisher set one. */
  orderingKey?: string;
  /** Server-assigned id of the published message, once Pub/Sub acknowledged the publish. */
  messageId?: string;
  /** Epoch ms at which the publish was issued. */
  startedAt: number;
  /**
   * Time until `publishMessage()` settled, in ms. It includes the time the message waited in the
   * client's batch, bounded by the topic's `batching.maxMilliseconds`.
   */
  duration: number;
  /** Message of the error `publishMessage()` failed with, when it failed. */
  error?: string;
  /** Runnable `topic.publishMessage(...)` snippet, precomputed for the UI copy button. */
  publishSnippet?: string;
  /**
   * Value-free key (the topic) used by the performance-rule engine to group repeated publishes
   * (the N+1 signal).
   */
  fingerprint?: string;
  /** Performance tags applied by the rule engine (slow, N+1, error…). */
  tags?: ProfilerTag[];
}

/** Private `profile.collectors` key where the patch accumulates raw publish entries. */
export const PUBSUB_PUBLISHES_KEY = '__pubsub_publishes';

export interface PubSubPublishCollectorModuleOptions
  extends CollectorModuleOptions, TagSeverityOptions {
  /**
   * Capture the message attributes passed to `publishMessage()`. Default: `true`.
   * Sensitive attributes are masked — see {@link PubSubPublishCollectorModuleOptions.maskAttributes}.
   */
  captureAttributes?: boolean;

  /**
   * Extra attribute names (case-insensitive) whose value is replaced with `[REDACTED]`. **Merged
   * with** the core's built-in sensitive-header list (`authorization`, `cookie`, …).
   */
  maskAttributes?: string[];

  /**
   * Capture the published message. Default: `true`.
   * Disable it when messages carry payloads too large or too sensitive to store.
   */
  captureBody?: boolean;

  /**
   * Depth / size caps applied to captured payloads, forwarded to the core's `toSafeData`.
   * Defaults to the core defaults (`maxDepth: 4`, `maxItems: 64`, `maxStringLength: 2048`).
   * Only meaningful when {@link PubSubPublishCollectorModuleOptions.captureBody} is enabled.
   */
  payloadLimits?: SafeDataOptions;

  /**
   * A publish at or above this duration (ms) is tagged `slow`. Default: `100`.
   *
   * Higher than the RabbitMQ default: a Pub/Sub publish waits for its batch to be sent (up to
   * `batching.maxMilliseconds`) and for a round-trip to the Google API.
   */
  slowThreshold?: number;

  /**
   * Publishes to the same topic repeated at least this many times in one profile are tagged
   * `n-plus-one`. Default: `5`.
   *
   * Higher than the RabbitMQ default: the client batches messages published in a row, so a few
   * publishes to one topic are idiomatic, not a smell.
   */
  nPlusOneThreshold?: number;

  /** A profile publishing at least this many messages is tagged `chatty`. Default: `10`. */
  chattyThreshold?: number;

  /**
   * What counts as a **failed publish** — what earns the `error` tag. A publish carries no
   * status code, so the default rests on `publishMessage()` having failed. Take over with
   * `classify` when an error is expected.
   *
   * ```ts
   * // A publish cancelled by a client shutdown is not an incident here.
   * PubSubPublishCollectorModule.forRoot({
   *   error: {
   *     classify: (entry) => (entry.error?.includes('CANCELLED') ? false : undefined),
   *   },
   * });
   * ```
   */
  error?: EntryErrorOptions;
}

/** Async configuration for `PubSubPublishCollectorModule.forRootAsync`. */
export type PubSubPublishCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<PubSubPublishCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
  };

/** DI token for `PubSubPublishCollectorModuleOptions`. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: PUBSUB_PUBLISH_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<PubSubPublishCollectorModuleOptions>()
    .setClassMethodName('forRoot')
    .build();
