import type { RabbitHandlerConfig } from '@golevelup/nestjs-rabbitmq';
import { describeSubscription } from './rabbitmq-subscription.describe';

const groupOf = (groups: ReturnType<typeof describeSubscription>, label: string) =>
  groups.find((group) => group.label === label);

describe('describeSubscription', () => {
  it('describes what the handler is bound to, naming the connection it runs on', () => {
    const config = {
      type: 'subscribe',
      exchange: 'articles.events',
      routingKey: ['published.*', 'updated.*'],
      queue: 'api-tts.narration',
      name: 'narration',
    } as RabbitHandlerConfig;

    expect(groupOf(describeSubscription(config, 'article-notification'), 'Subscription')).toEqual({
      label: 'Subscription',
      items: [
        { name: 'queue', description: 'api-tts.narration' },
        { name: 'exchange', description: 'articles.events' },
        { name: 'routingKey', description: 'published.*, updated.*' },
        { name: 'connection', description: 'article-notification' },
        { name: 'handler config', description: 'narration' },
      ],
    });
  });

  it('labels the default exchange and a broker-generated queue rather than leaving them blank', () => {
    const items = groupOf(describeSubscription({ type: 'subscribe' }), 'Subscription')?.items;
    expect(items).toEqual([
      { name: 'queue', description: '(broker-generated)' },
      { name: 'exchange', description: '(default)' },
    ]);
  });

  it('spreads the queue options and their x-… arguments into one item each', () => {
    const config = {
      type: 'subscribe',
      queue: 'api-tts.callback',
      queueOptions: {
        durable: true,
        channel: 'callbacks',
        messageTtl: 5000,
        arguments: {
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': 'api-tts.callback.dlq',
        },
      },
    } as RabbitHandlerConfig;

    const groups = describeSubscription(config);
    // The channel belongs with the subscription — it selects which consumer channel is used.
    expect(groupOf(groups, 'Subscription')?.items).toContainEqual({
      name: 'channel',
      description: 'callbacks',
    });
    expect(groupOf(groups, 'Queue options')?.items).toEqual([
      { name: 'durable', description: 'true' },
      { name: 'messageTtl', description: '5000' },
      // An empty exchange is the default exchange, not a missing value.
      { name: 'x-dead-letter-exchange', description: '(default)' },
      { name: 'x-dead-letter-routing-key', description: 'api-tts.callback.dlq' },
    ]);
  });

  it('lists multi-exchange bindings as their own group', () => {
    const config = {
      type: 'subscribe',
      queue: 'audit',
      bindings: [
        { exchange: 'orders', routingKey: 'order.created' },
        { exchange: '', routingKey: 'audit' },
      ],
    } as RabbitHandlerConfig;

    expect(groupOf(describeSubscription(config), 'Bindings')?.items).toEqual([
      { name: 'orders → order.created' },
      { name: '(default) → audit' },
    ]);
  });

  it('summarizes the behavioural options, naming a custom function for what it is', () => {
    const config = {
      type: 'rpc',
      queue: 'rpc.sum',
      allowNonJsonMessages: true,
      errorBehavior: 'NACK',
      batchOptions: { size: 20, timeout: 100 },
      deserializer: (): unknown => undefined,
    } as unknown as RabbitHandlerConfig;

    expect(groupOf(describeSubscription(config), 'Behaviour')?.items).toEqual([
      { name: 'allowNonJsonMessages', description: 'true' },
      { name: 'errorBehavior', description: 'NACK' },
      { name: 'deserializer', description: '(custom function)' },
      { name: 'batchOptions', description: '{"size":20,"timeout":100}' },
    ]);
  });

  it('emits no empty group when the subscription declares nothing but its binding', () => {
    const groups = describeSubscription({ type: 'subscribe', queue: 'plain' });
    expect(groups.map((group) => group.label)).toEqual(['Subscription']);
  });
});
