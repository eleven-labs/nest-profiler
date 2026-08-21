import type { RabbitMQConfig } from '@golevelup/nestjs-rabbitmq';
import { connectionName, describeTopology } from './rabbitmq-topology.describe';
import type { DiscoveredRabbitMqConnection } from './rabbitmq-topology.describe';

const connection = (
  name: string,
  config: Partial<RabbitMQConfig>,
): DiscoveredRabbitMqConnection => ({
  name,
  config: { uri: 'amqp://localhost', ...config },
});

const sectionOf = (sections: ReturnType<typeof describeTopology>, label: string) =>
  sections.find((section) => section.label === label);

describe('describeTopology', () => {
  it('lists the connections with their credentials masked', () => {
    const sections = describeTopology([
      connection('tts', {
        uri: 'amqp://guest:s3cret@rabbit:5672/api-tts',
        prefetchCount: 20,
        channels: { default: { default: true }, heavy: { prefetchCount: 1 } },
        handlers: { narration: { queue: 'q' } },
      }),
    ]);

    expect(sectionOf(sections, 'Connections')).toEqual({
      label: 'Connections',
      itemLabel: 'connection',
      items: [
        {
          name: 'tts',
          detail: 'amqp://[REDACTED]@rabbit:5672/api-tts',
          attributes: {
            prefetch: '20',
            channels: 'default, heavy',
            'handler configs': 'narration',
          },
        },
      ],
    });
  });

  it('renders the object URI form without inventing credentials', () => {
    const sections = describeTopology([
      connection('default', {
        uri: { protocol: 'amqps', hostname: 'broker', port: 5671, vhost: '/api-tts' },
      }),
    ]);
    expect(sectionOf(sections, 'Connections')?.items[0]?.detail).toBe(
      'amqps://broker:5671/api-tts',
    );
  });

  it('flags a connection that registers no handler — it consumes nothing', () => {
    const sections = describeTopology([connection('publisher', { registerHandlers: false })]);
    expect(sectionOf(sections, 'Connections')?.items[0]?.flags).toEqual(['handlers disabled']);
  });

  it('describes exchanges with their type, durability and arguments', () => {
    const sections = describeTopology([
      connection('default', {
        defaultExchangeType: 'topic',
        exchanges: [
          { name: 'articles.events', type: 'topic', options: { durable: true } },
          { name: 'untyped', options: { alternateExchange: 'fallback' } },
        ],
      }),
    ]);

    expect(sectionOf(sections, 'Exchanges')).toEqual({
      label: 'Exchanges',
      itemLabel: 'exchange',
      items: [
        { name: 'articles.events', kind: 'topic', flags: ['durable'] },
        { name: 'untyped', kind: 'topic', attributes: { 'alternate-exchange': 'fallback' } },
      ],
    });
  });

  it('shows the binding that feeds each queue, including the default-exchange case', () => {
    const sections = describeTopology([
      connection('default', {
        queues: [
          {
            name: 'api-tts.narration',
            exchange: 'articles.events',
            routingKey: ['published.*', 'updated.*'],
            options: { durable: true, arguments: { 'x-dead-letter-exchange': 'tts.dlx' } },
          },
          { name: 'api-tts.callback', options: { durable: true, messageTtl: 5000 } },
        ],
      }),
    ]);

    expect(sectionOf(sections, 'Queues')?.items).toEqual([
      {
        name: 'api-tts.narration',
        detail: '← articles.events (published.*, updated.*)',
        flags: ['durable'],
        attributes: { 'x-dead-letter-exchange': 'tts.dlx' },
      },
      {
        name: 'api-tts.callback',
        detail: '← (default)',
        flags: ['durable'],
        attributes: { 'message-ttl': '5000' },
      },
    ]);
  });

  it('attributes each item to its connection only when several are declared', () => {
    const single = describeTopology([
      connection('only', { exchanges: [{ name: 'e' }], queues: [{ name: 'q' }] }),
    ]);
    expect(sectionOf(single, 'Exchanges')?.items[0]?.attributes).toBeUndefined();

    const many = describeTopology([
      connection('article-notification', { exchanges: [{ name: 'articles.events' }] }),
      connection('tts', { queues: [{ name: 'api-tts.callback' }] }),
    ]);
    expect(sectionOf(many, 'Exchanges')?.items[0]?.attributes).toEqual({
      connection: 'article-notification',
    });
    expect(sectionOf(many, 'Queues')?.items[0]?.attributes).toEqual({ connection: 'tts' });
  });

  it('names the default exchange in a dead-letter argument instead of leaving it blank', () => {
    const sections = describeTopology([
      connection('default', {
        queues: [
          {
            name: 'retry',
            options: {
              arguments: { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': 'work' },
            },
          },
        ],
      }),
    ]);
    expect(sectionOf(sections, 'Queues')?.items[0]?.attributes).toEqual({
      'x-dead-letter-exchange': '(default)',
      'x-dead-letter-routing-key': 'work',
    });
  });

  it('lists exchange-to-exchange bindings with their pattern', () => {
    const sections = describeTopology([
      connection('default', {
        exchangeBindings: [{ source: 'retry', destination: 'articles.events', pattern: '#' }],
      }),
    ]);
    expect(sectionOf(sections, 'Exchange bindings')?.items).toEqual([
      { name: 'retry → articles.events', detail: 'pattern: #' },
    ]);
  });

  it('emits nothing when no connection was discovered, and skips empty sections', () => {
    expect(describeTopology([])).toEqual([]);
    expect(describeTopology([connection('bare', {})]).map((section) => section.label)).toEqual([
      'Connections',
    ]);
  });
});

describe('connectionName', () => {
  it('falls back to `default` for the unnamed connection', () => {
    expect(connectionName({ uri: 'amqp://localhost' })).toBe('default');
    expect(connectionName({ uri: 'amqp://localhost', name: 'tts' })).toBe('tts');
  });
});
