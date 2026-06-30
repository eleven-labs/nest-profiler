import type { RabbitMqInfo } from './rabbitmq-collector.interface';

/**
 * Builds a runnable amqplib `channel.publish(...)` snippet that re-emits the
 * consumed message, mirroring the Symfony Web Profiler "copy" affordance.
 *
 * The payload is embedded as `Buffer.from(JSON.stringify(...))` and the AMQP
 * options (headers, messageId, appId) are included when present.
 *
 * Exported for unit testing; not part of the package's public API.
 */
export function buildAmqpPublish(info: RabbitMqInfo): string {
  const exchange = JSON.stringify(info.exchange ?? '');
  const routingKey = JSON.stringify(info.routingKey ?? '');
  const payload = `Buffer.from(JSON.stringify(${JSON.stringify(info.payload ?? null)}))`;

  const options: Record<string, unknown> = {};
  if (info.headers && Object.keys(info.headers).length > 0) options.headers = info.headers;
  if (info.messageId) options.messageId = info.messageId;
  if (info.appId) options.appId = info.appId;

  const args = [exchange, routingKey, payload];
  if (Object.keys(options).length > 0) args.push(JSON.stringify(options, null, 2));

  return `channel.publish(\n  ${args.join(',\n  ')},\n);`;
}
