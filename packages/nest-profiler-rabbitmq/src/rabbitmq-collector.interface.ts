/** DI token for `RabbitMqCollectorModuleOptions`. */
export const RABBITMQ_COLLECTOR_OPTIONS = Symbol('RABBITMQ_COLLECTOR_OPTIONS');

/** `Profile.entrypoint.type` value marking a profile as a consumed RabbitMQ message. */
export const RABBITMQ_ENTRYPOINT_TYPE = 'rabbitmq';

/** golevelup's `ExecutionContext` type string for `@RabbitSubscribe` handlers. */
export const RMQ_CONTEXT_TYPE = 'rmq';

/** Header names (lowercase) masked by default in the captured AMQP headers. */
export const DEFAULT_MASK_HEADERS = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];

/** Payload of a `rabbitmq` entrypoint — the consumed AMQP message a profile describes. */
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
  /** AMQP consumer tag the message was delivered to. */
  consumerTag?: string;
  /** AMQP delivery tag (per-channel monotonic id). */
  deliveryTag?: number;
  /** `messageId` AMQP property, when set by the publisher. */
  messageId?: string;
  /** `appId` AMQP property, when set by the publisher. */
  appId?: string;
  /** Masked AMQP headers captured from the message, when `captureHeaders` is enabled. */
  headers?: Record<string, string>;
  /** Deserialized message payload, when `captureBody` is enabled. */
  payload?: unknown;
}
