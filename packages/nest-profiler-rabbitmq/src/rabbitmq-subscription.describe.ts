import type { RabbitHandlerConfig } from '@golevelup/nestjs-rabbitmq';
import type { DiscoverInputGroup, DiscoverInputItem } from '@eleven-labs/nest-profiler';
import {
  DEFAULT_EXCHANGE_LABEL,
  GENERATED_QUEUE_LABEL,
  formatEmptyValue,
  orLabel,
} from './rabbitmq-labels';

/**
 * `queueOptions` keys rendered under **Queue options**, in a deliberate reading order:
 * the durability traits first, then the dead-letter routing, then the caps. `arguments` is
 * spread into one item per `x-…` key (see {@link queueOptionItems}) and `channel` is surfaced
 * with the subscription itself, so both are absent here.
 */
const QUEUE_OPTION_KEYS = [
  'durable',
  'exclusive',
  'autoDelete',
  'messageTtl',
  'expires',
  'deadLetterExchange',
  'deadLetterRoutingKey',
  'maxLength',
  'maxPriority',
  'consumerOptions',
  'bindQueueArguments',
] as const;

/**
 * `@RabbitSubscribe` keys that change how the handler *behaves* rather than what it is bound
 * to — the error strategy, the deserialization contract, consumer-side batching.
 */
const BEHAVIOUR_KEYS = [
  'allowNonJsonMessages',
  'createQueueIfNotExists',
  'usePersistentReplyTo',
  'errorBehavior',
  'errorHandler',
  'assertQueueErrorHandler',
  'deserializer',
  'batchOptions',
] as const;

/**
 * Formats a subscription value for display. Primitives render verbatim; a function (an error
 * handler, a custom deserializer) is named for what it is, since its body says nothing here;
 * objects are JSON-encoded so `{ 'x-message-ttl': 5000 }` stays readable in one line.
 */
function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'function') return '(custom function)';
  if (value === null) return 'null';
  try {
    return JSON.stringify(value) ?? '(unserializable)';
  } catch {
    return '(unserializable)';
  }
}

/** `routingKey` accepts one key or a list; both read as a single comma-separated string. */
function joinRoutingKeys(routingKey?: string | string[]): string | undefined {
  const keys = (Array.isArray(routingKey) ? routingKey : [routingKey]).filter(
    (key): key is string => typeof key === 'string' && key.length > 0,
  );
  return keys.length > 0 ? keys.join(', ') : undefined;
}

/** Appends `name: value` to a group, skipping values the subscription never set. */
function push(items: DiscoverInputItem[], name: string, value: unknown): void {
  if (value === undefined) return;
  items.push({ name, description: formatEmptyValue(name, formatValue(value)) });
}

/** What the handler is bound to: its queue, exchange, routing keys, connection and channel. */
function subscriptionItems(config: RabbitHandlerConfig, connection?: string): DiscoverInputItem[] {
  const items: DiscoverInputItem[] = [];
  push(items, 'queue', orLabel(config.queue, GENERATED_QUEUE_LABEL));
  push(items, 'exchange', orLabel(config.exchange, DEFAULT_EXCHANGE_LABEL));
  push(items, 'routingKey', joinRoutingKeys(config.routingKey));
  push(items, 'connection', connection);
  // A handler config declared at module level (`handlers: { … }`) and referenced by name — the
  // options shown here are the merged result, so the key is worth naming.
  push(items, 'handler config', config.name);
  push(items, 'channel', config.queueOptions?.channel);
  return items;
}

/** The `queueOptions` the subscription declared, with `arguments` spread one `x-…` key per item. */
function queueOptionItems(config: RabbitHandlerConfig): DiscoverInputItem[] {
  const options = config.queueOptions;
  if (!options) return [];
  const items: DiscoverInputItem[] = [];
  for (const key of QUEUE_OPTION_KEYS) {
    push(items, key, options[key]);
  }
  const args = options.arguments as Record<string, unknown> | undefined;
  for (const [name, value] of Object.entries(args ?? {})) {
    push(items, name, value);
  }
  return items;
}

/** The behavioural options: error strategy, deserialization, batching. */
function behaviourItems(config: RabbitHandlerConfig): DiscoverInputItem[] {
  const items: DiscoverInputItem[] = [];
  for (const key of BEHAVIOUR_KEYS) {
    push(items, key, config[key]);
  }
  return items;
}

/**
 * Describes one resolved `@RabbitSubscribe` / `@RabbitRPC` configuration as **Discover** input
 * groups — the RabbitMQ counterpart of a CLI command's arguments and options. Instead of the
 * single `exchange → routingKey` locator, the panel then shows everything the subscription
 * declared: what it is bound to, the queue it asserts (TTLs, dead-letter routing, caps) and how
 * it behaves on failure.
 *
 * @param config - The handler config read off the `RABBIT_HANDLER` metadata, already merged with
 *   its module-level `handlers` entry when it references one.
 * @param connection - Name of the connection the handler is registered on, when resolvable.
 */
export function describeSubscription(
  config: RabbitHandlerConfig,
  connection?: string,
): DiscoverInputGroup[] {
  const groups: DiscoverInputGroup[] = [
    { label: 'Subscription', items: subscriptionItems(config, connection) },
  ];

  // Multi-exchange bindings (`bindings: [{ exchange, routingKey }]`) are a list, not a scalar:
  // they get their own group so each binding reads as one line.
  const bindings = config.bindings ?? [];
  if (bindings.length > 0) {
    groups.push({
      label: 'Bindings',
      items: bindings.map((binding) => ({
        name: `${orLabel(binding.exchange, DEFAULT_EXCHANGE_LABEL)} → ${binding.routingKey}`,
      })),
    });
  }

  const queueOptions = queueOptionItems(config);
  if (queueOptions.length > 0) groups.push({ label: 'Queue options', items: queueOptions });

  const behaviour = behaviourItems(config);
  if (behaviour.length > 0) groups.push({ label: 'Behaviour', items: behaviour });

  return groups.filter((group) => group.items.length > 0);
}
