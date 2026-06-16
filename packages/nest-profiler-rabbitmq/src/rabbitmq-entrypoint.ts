import * as path from 'path';
import type {
  EntrypointSummary,
  Profile,
  ProfilerEntrypointType,
  ProfilerFilterOption,
  ProfilerListFilter,
} from '@eleven-labs/nest-profiler';
import { RABBITMQ_ENTRYPOINT_TYPE } from './rabbitmq-collector.interface';
import type { RabbitMqInfo } from './rabbitmq-collector.interface';

const TEMPLATES_DIR = path.join(__dirname, 'templates');

const MESSAGE_ICON =
  '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 4v-4z"/></svg>';

/** Label standing in for the AMQP default exchange (an empty exchange name). */
const DEFAULT_EXCHANGE_LABEL = '(default)';

const exchangeLabel = (data: RabbitMqInfo): string =>
  data.exchange && data.exchange.length > 0 ? data.exchange : DEFAULT_EXCHANGE_LABEL;

/** Builds an ascending "All" + distinct-values option list from the section's profiles. */
const distinctOptions = (
  profiles: Profile<RabbitMqInfo>[],
  pick: (data: RabbitMqInfo) => string | undefined,
): ProfilerFilterOption[] => {
  const values = new Set<string>();
  for (const profile of profiles) {
    const value = pick(profile.entrypoint.data);
    if (value && value.length > 0) values.add(value);
  }
  return [
    { value: '', label: 'All' },
    ...[...values].sort().map((value) => ({ value, label: value })),
  ];
};

/** RabbitMQ-only filter: narrows the Messages list to first deliveries or redeliveries. */
const redeliveredFilter: ProfilerListFilter<string> = {
  key: 'redelivered',
  label: 'Delivery',
  control: 'select',
  order: 20,
  options: [
    { value: '', label: 'All' },
    { value: 'redelivered', label: 'Redelivered' },
    { value: 'first', label: 'First delivery' },
  ],
  parse: (raw) => (typeof raw === 'string' && raw.length > 0 ? raw : undefined),
  matches: (profile: Profile<RabbitMqInfo>, value) =>
    value === 'redelivered'
      ? profile.entrypoint.data.redelivered === true
      : profile.entrypoint.data.redelivered !== true,
};

/** RabbitMQ-only filter: narrows the list to one exchange (options are the exchanges seen). */
const exchangeFilter: ProfilerListFilter<string> = {
  key: 'exchange',
  label: 'Exchange',
  control: 'select',
  order: 21,
  optionsFor: (profiles: Profile<RabbitMqInfo>[]) =>
    distinctOptions(profiles, (data) => exchangeLabel(data)),
  parse: (raw) => (typeof raw === 'string' && raw.length > 0 ? raw : undefined),
  matches: (profile: Profile<RabbitMqInfo>, value) =>
    exchangeLabel(profile.entrypoint.data) === value,
};

/** RabbitMQ-only filter: narrows the list to one consumer handler (options are the handlers seen). */
const handlerFilter: ProfilerListFilter<string> = {
  key: 'handler',
  label: 'Handler',
  control: 'select',
  order: 22,
  optionsFor: (profiles: Profile<RabbitMqInfo>[]) =>
    distinctOptions(profiles, (data) => data.handler),
  parse: (raw) => (typeof raw === 'string' && raw.length > 0 ? raw : undefined),
  matches: (profile: Profile<RabbitMqInfo>, value) => profile.entrypoint.data.handler === value,
};

/** RabbitMQ-only filter: case-insensitive substring match on the routing key. */
const routingKeyFilter: ProfilerListFilter<string> = {
  key: 'routingKey',
  label: 'Routing key',
  control: 'text',
  order: 23,
  placeholder: 'published.*, tts.…',
  parse: (raw) => (typeof raw === 'string' && raw.length > 0 ? raw.toLowerCase() : undefined),
  matches: (profile: Profile<RabbitMqInfo>, value) =>
    profile.entrypoint.data.routingKey.toLowerCase().includes(value),
};

/**
 * The `rabbitmq` entrypoint: messages consumed via `@RabbitSubscribe` render in
 * their own list table and on a dedicated "Message" detail tab (no
 * request/response tabs). Registered by {@link RabbitMqCollectorModule}.
 */
export const RABBITMQ_ENTRYPOINT_TYPE_DEF: ProfilerEntrypointType = {
  type: RABBITMQ_ENTRYPOINT_TYPE,
  label: 'RabbitMQ',
  listSection: {
    title: 'RabbitMQ',
    description: 'RabbitMQ messages consumed via @RabbitSubscribe',
    order: 30,
    itemLabel: 'message',
    templatePath: path.join(TEMPLATES_DIR, 'rabbitmq-section.ejs'),
  },
  detailTabs: [
    {
      name: 'message',
      label: 'Message',
      icon: MESSAGE_ICON,
      templatePath: path.join(TEMPLATES_DIR, 'message.ejs'),
    },
  ],
  listFilters: [redeliveredFilter, exchangeFilter, handlerFilter, routingKeyFilter],
  summary(profile: Profile<RabbitMqInfo>): EntrypointSummary {
    const rmq = profile.entrypoint.data;
    return {
      badge: 'RMQ',
      badgeClass: 'badge-default',
      text: `${rmq.exchange || '(default)'} → ${rmq.routingKey}`,
    };
  },
};
