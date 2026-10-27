import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';
import type {
  CollectorModuleOptions,
  ProfilerErrorOptions,
  RedactionHeaderOptions,
} from '@eleven-labs/nest-profiler';

export interface RabbitMqCollectorModuleOptions
  extends CollectorModuleOptions, RedactionHeaderOptions {
  /**
   * Message header the consumed message's trace id is read from — what files the consumer's
   * profile under the trace of the request that published it. Default: `x-request-id`, the header
   * `RabbitMqPublishCollectorModule`'s `propagateTraceId: true` writes.
   *
   * When the header is absent, the message's `correlationId` is adopted instead, for a publisher
   * that sets it to the trace id itself; a message carrying neither opens a trace of its own.
   */
  traceIdHeader?: string;

  /**
   * Capture incoming RabbitMQ message headers. Default: `true`.
   * Sensitive headers are masked — see {@link maskHeaders}.
   */
  captureHeaders?: boolean;

  /**
   * Capture the deserialized message payload. Default: `true`.
   * Enable with caution — payloads can be large.
   */
  captureBody?: boolean;

  /**
   * What counts as a **failed message** — what earns the `error` tag and what the list's
   * `Errors` filter keeps. A consumed message has no status code, so the default is simply
   * "the handler threw".
   *
   * ```ts
   * // A handler that throws to trigger a retry is not an incident; a timeout is.
   * RabbitMqCollectorModule.forRoot({ error: { exceptions: ['TimeoutError'] } });
   * ```
   */
  error?: ProfilerErrorOptions;
}

/** Async configuration for `RabbitMqCollectorModule.forRootAsync`. */
export type RabbitMqCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<RabbitMqCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
  };

/** DI token for `RabbitMqCollectorModuleOptions`. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: RABBITMQ_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<RabbitMqCollectorModuleOptions>()
    .setClassMethodName('forRoot')
    .build();

/** `Profile.entrypoint.type` value marking a profile as a consumed RabbitMQ message. */
export const RABBITMQ_ENTRYPOINT_TYPE = 'rabbitmq';

/** golevelup's `ExecutionContext` type string for `@RabbitSubscribe` handlers. */
export const RMQ_CONTEXT_TYPE = 'rmq';

/** Payload of a `rabbitmq` entrypoint — the consumed RabbitMQ message a profile describes. */
export interface RabbitMqInfo {
  /** Exchange the message was published to (empty string for the default exchange). */
  exchange: string;
  /** Routing key the message was published with. */
  routingKey: string;
  /** Queue the consumer is bound to, when known. */
  queue?: string;
  /** Fully-qualified handler, e.g. `NarrationService.createGeneration`. */
  handler?: string;
  /** `true` when the broker redelivered the message (a previous attempt failed). */
  redelivered?: boolean;
  /** RabbitMQ consumer tag the message was delivered to. */
  consumerTag?: string;
  /** RabbitMQ delivery tag (per-channel monotonic id). */
  deliveryTag?: number;
  /** `messageId` message property, when set by the publisher. */
  messageId?: string;
  /** `appId` message property, when set by the publisher. */
  appId?: string;
  /** Masked RabbitMQ headers captured from the message, when `captureHeaders` is enabled. */
  headers?: Record<string, string>;
  /** Deserialized message payload, when `captureBody` is enabled. */
  payload?: unknown;
  /** Runnable amqplib `channel.publish(...)` snippet, precomputed for the UI copy button. */
  publishSnippet?: string;
}
