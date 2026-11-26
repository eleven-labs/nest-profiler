import { buildPubSubPublish } from './build-pubsub-publish.js';

describe('buildPubSubPublish', () => {
  it('passes a JSON payload as json, with the attributes and the ordering key', () => {
    const snippet = buildPubSubPublish({
      topic: 'orders',
      payload: { id: 42 },
      attributes: { eventType: 'order.created' },
      orderingKey: 'customer-1',
    });

    expect(snippet).toBe(
      [
        'await pubsub.topic("orders").publishMessage({',
        '  json: {',
        '    "id": 42',
        '  },',
        '  attributes: {',
        '    "eventType": "order.created"',
        '  },',
        '  orderingKey: "customer-1",',
        '});',
      ].join('\n'),
    );
  });

  it('passes a plain-text payload as a data buffer', () => {
    expect(buildPubSubPublish({ topic: 'logs', payload: 'hello' })).toContain(
      'data: Buffer.from("hello")',
    );
  });

  it('publishes an empty message when nothing was captured', () => {
    expect(buildPubSubPublish({ topic: 'pings', attributes: {} })).toBe(
      'await pubsub.topic("pings").publishMessage({});',
    );
  });
});
