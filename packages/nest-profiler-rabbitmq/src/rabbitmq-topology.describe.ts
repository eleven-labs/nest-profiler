import { redactString } from '@eleven-labs/nest-profiler';
import type { DiscoverSection, DiscoverSectionItem } from '@eleven-labs/nest-profiler';
import type {
  RabbitMQConfig,
  RabbitMQExchangeConfig,
  RabbitMQQueueConfig,
  RabbitMQUriConfig,
} from '@golevelup/nestjs-rabbitmq';
import {
  DEFAULT_EXCHANGE_LABEL,
  GENERATED_QUEUE_LABEL,
  formatEmptyValue,
  orLabel,
} from './rabbitmq-labels';

/** Name golevelup gives the single unnamed connection. */
const DEFAULT_CONNECTION_NAME = 'default';

/** One RabbitMQ connection the application declared, as discovered at bootstrap. */
export interface DiscoveredRabbitMqConnection {
  /** Connection name (`RabbitMQConfig.name`), or `default` for the unnamed one. */
  name: string;
  /** The configuration the connection was built from. */
  config: RabbitMQConfig;
}

/**
 * Renders one broker URI with its credentials masked. golevelup normalizes the object form to a
 * string before connecting, but the object form is still what a host may have configured, so both
 * are handled here.
 */
function formatUri(uri: RabbitMQUriConfig): string {
  if (typeof uri === 'string') return redactString(uri);
  const protocol = uri.protocol ?? 'amqp';
  const port = uri.port !== undefined ? `:${uri.port}` : '';
  const vhost = uri.vhost !== undefined ? `/${uri.vhost.replace(/^\//, '')}` : '';
  return `${protocol}://${uri.hostname ?? 'localhost'}${port}${vhost}`;
}

/** Adds `name: value` to an attribute bag, skipping what the configuration never set. */
function put(attributes: Record<string, string>, name: string, value: unknown): void {
  if (value === undefined || value === null) return;
  attributes[name] = formatEmptyValue(
    name,
    typeof value === 'string' ? value : JSON.stringify(value),
  );
}

/** Spreads an `arguments` bag (`x-message-ttl`, `x-dead-letter-exchange`, …) into attributes. */
function putArguments(attributes: Record<string, string>, args: unknown): void {
  if (args === null || typeof args !== 'object') return;
  for (const [name, value] of Object.entries(args as Record<string, unknown>)) {
    put(attributes, name, value);
  }
}

/** Only attaches an attribute bag when it holds something. */
function withAttributes(
  item: DiscoverSectionItem,
  attributes: Record<string, string>,
): DiscoverSectionItem {
  return Object.keys(attributes).length > 0 ? { ...item, attributes } : item;
}

/** The connections themselves: their broker URI (masked), prefetch and declared channels. */
function connectionItems(connections: DiscoveredRabbitMqConnection[]): DiscoverSectionItem[] {
  return connections.map(({ name, config }) => {
    const uris = (Array.isArray(config.uri) ? config.uri : [config.uri]).filter(Boolean);
    const flags: string[] = [];
    // Only what departs from the golevelup defaults: a connection that registers no handler
    // consumes nothing, and controller discovery changes where handlers are looked for. Flagging
    // `enableDirectReplyTo` too would tag every connection, since it defaults to on.
    if (config.registerHandlers === false) flags.push('handlers disabled');
    if (config.enableControllerDiscovery) flags.push('controller discovery');

    const attributes: Record<string, string> = {};
    put(attributes, 'prefetch', config.prefetchCount);
    const channels = Object.keys(config.channels ?? {});
    if (channels.length > 0) put(attributes, 'channels', channels.join(', '));
    const handlers = Object.keys(config.handlers ?? {});
    if (handlers.length > 0) put(attributes, 'handler configs', handlers.join(', '));

    const item: DiscoverSectionItem = { name, detail: uris.map(formatUri).join(', ') };
    return withAttributes(flags.length > 0 ? { ...item, flags } : item, attributes);
  });
}

/** One exchange as declared in `exchanges: [...]`. */
function exchangeItem(
  exchange: RabbitMQExchangeConfig,
  config: RabbitMQConfig,
  connection?: string,
): DiscoverSectionItem {
  const options = exchange.options ?? {};
  const flags: string[] = [];
  if (options.durable) flags.push('durable');
  if (options.autoDelete) flags.push('auto-delete');
  if (options.internal) flags.push('internal');
  if (exchange.createExchangeIfNotExists === false) flags.push('not asserted');

  const attributes: Record<string, string> = {};
  if (connection) put(attributes, 'connection', connection);
  put(attributes, 'alternate-exchange', options.alternateExchange);
  putArguments(attributes, options.arguments);

  const item: DiscoverSectionItem = {
    name: orLabel(exchange.name, DEFAULT_EXCHANGE_LABEL),
    kind: exchange.type ?? config.defaultExchangeType,
  };
  return withAttributes(flags.length > 0 ? { ...item, flags } : item, attributes);
}

/** One queue as declared in `queues: [...]`, with the binding that feeds it. */
function queueItem(queue: RabbitMQQueueConfig, connection?: string): DiscoverSectionItem {
  const options = queue.options ?? {};
  const flags: string[] = [];
  if (options.durable) flags.push('durable');
  if (options.exclusive) flags.push('exclusive');
  if (options.autoDelete) flags.push('auto-delete');
  if (queue.createQueueIfNotExists === false) flags.push('not asserted');

  const routingKeys = (Array.isArray(queue.routingKey) ? queue.routingKey : [queue.routingKey])
    .filter((key): key is string => typeof key === 'string' && key.length > 0)
    .join(', ');
  // A queue with no exchange is fed through the default exchange (routing key = queue name),
  // which is exactly how a dead-letter or delay queue redelivers to its consumer.
  const source = orLabel(queue.exchange, DEFAULT_EXCHANGE_LABEL);
  const detail = routingKeys ? `← ${source} (${routingKeys})` : `← ${source}`;

  const attributes: Record<string, string> = {};
  if (connection) put(attributes, 'connection', connection);
  put(attributes, 'consumer tag', queue.consumerTag);
  put(attributes, 'message-ttl', options.messageTtl);
  put(attributes, 'expires', options.expires);
  put(attributes, 'dead-letter-exchange', options.deadLetterExchange);
  put(attributes, 'dead-letter-routing-key', options.deadLetterRoutingKey);
  put(attributes, 'max-length', options.maxLength);
  put(attributes, 'max-priority', options.maxPriority);
  putArguments(attributes, options.arguments);
  putArguments(attributes, queue.bindQueueArguments);

  const item: DiscoverSectionItem = { name: orLabel(queue.name, GENERATED_QUEUE_LABEL), detail };
  return withAttributes(flags.length > 0 ? { ...item, flags } : item, attributes);
}

/**
 * Describes the RabbitMQ topology the application **declared** — its connections, exchanges,
 * queues and exchange-to-exchange bindings — as **Discover** sections rendered above the handler
 * list.
 *
 * It answers the question the handler list cannot: a `@RabbitSubscribe` names one queue, but the
 * dead-letter exchange it is bound to, the retry queue that TTLs back into it and the exchanges
 * the application only publishes to all live in the module configuration. Read from the
 * configuration rather than from the broker, so it reflects what this application asserts — no
 * management-API call, no credentials, and it works while the broker is down.
 *
 * @param connections - The connections discovered at bootstrap, in declaration order.
 */
export function describeTopology(connections: DiscoveredRabbitMqConnection[]): DiscoverSection[] {
  if (connections.length === 0) return [];
  // A single connection needs no per-item connection attribute — everything belongs to it.
  const named = connections.length > 1;

  const exchanges: DiscoverSectionItem[] = [];
  const queues: DiscoverSectionItem[] = [];
  const bindings: DiscoverSectionItem[] = [];

  for (const { name, config } of connections) {
    const connection = named ? name : undefined;
    for (const exchange of config.exchanges ?? []) {
      exchanges.push(exchangeItem(exchange, config, connection));
    }
    for (const queue of config.queues ?? []) {
      queues.push(queueItem(queue, connection));
    }
    for (const binding of config.exchangeBindings ?? []) {
      const attributes: Record<string, string> = {};
      if (connection) put(attributes, 'connection', connection);
      putArguments(attributes, binding.args);
      bindings.push(
        withAttributes(
          {
            name: `${orLabel(binding.source, DEFAULT_EXCHANGE_LABEL)} → ${binding.destination}`,
            detail: `pattern: ${binding.pattern}`,
          },
          attributes,
        ),
      );
    }
  }

  const sections: DiscoverSection[] = [
    { label: 'Connections', itemLabel: 'connection', items: connectionItems(connections) },
  ];
  if (exchanges.length > 0) {
    sections.push({ label: 'Exchanges', itemLabel: 'exchange', items: exchanges });
  }
  if (queues.length > 0) sections.push({ label: 'Queues', itemLabel: 'queue', items: queues });
  if (bindings.length > 0) {
    sections.push({ label: 'Exchange bindings', itemLabel: 'binding', items: bindings });
  }
  return sections;
}

/** Resolves the display name of a connection config (`default` when it is the unnamed one). */
export function connectionName(config: RabbitMQConfig): string {
  return config.name && config.name.length > 0 ? config.name : DEFAULT_CONNECTION_NAME;
}
