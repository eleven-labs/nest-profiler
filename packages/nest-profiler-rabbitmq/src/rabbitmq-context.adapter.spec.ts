import type { ExecutionContext } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';
import { RabbitMqContextAdapter } from './rabbitmq-context.adapter';
import { RABBITMQ_ENTRYPOINT_TYPE } from './rabbitmq-collector.interface';
import type { RabbitMqInfo } from './rabbitmq-collector.interface';

function makeMessage(overrides: Partial<ConsumeMessage> = {}): ConsumeMessage {
  return {
    fields: {
      exchange: 'articles.events',
      routingKey: 'published.LEFIGARO',
      redelivered: false,
      consumerTag: 'ct-1',
      deliveryTag: 7,
    },
    properties: { headers: {}, messageId: 'mid-1', appId: 'api-notif' },
    content: Buffer.from(''),
    ...overrides,
  } as unknown as ConsumeMessage;
}

function makeCtx(
  message: ConsumeMessage,
  payload: unknown,
  className = 'NarrationService',
  handlerName = 'createGeneration',
): ExecutionContext {
  return {
    switchToRpc: () => ({ getContext: () => message, getData: () => payload }),
    getClass: () => ({ name: className }),
    getHandler: () => ({ name: handlerName }),
  } as unknown as ExecutionContext;
}

describe('RabbitMqContextAdapter', () => {
  it('recoverProfile creates a fresh RMQ profile', () => {
    const adapter = new RabbitMqContextAdapter({});
    const profile = adapter.recoverProfile();
    expect(profile.entrypoint.type).toBe(RABBITMQ_ENTRYPOINT_TYPE);
    expect(typeof profile.token).toBe('string');
    expect(profile.collectors).toEqual({});
    expect(profile.performance.startTime).toBeGreaterThan(0);
  });

  it('enrichProfile fills entrypoint data, headers and payload', () => {
    const adapter = new RabbitMqContextAdapter({});
    const profile = adapter.recoverProfile();
    adapter.enrichProfile(profile, makeCtx(makeMessage(), { graphId: 'g1', externalId: 'e1' }));

    expect(profile.entrypoint.type).toBe(RABBITMQ_ENTRYPOINT_TYPE);
    const data = profile.entrypoint.data as RabbitMqInfo;
    expect(data.exchange).toBe('articles.events');
    expect(data.routingKey).toBe('published.LEFIGARO');
    expect(data.payload).toEqual({ graphId: 'g1', externalId: 'e1' });
    expect(data).toEqual({
      exchange: 'articles.events',
      routingKey: 'published.LEFIGARO',
      handler: 'NarrationService.createGeneration',
      redelivered: false,
      consumerTag: 'ct-1',
      deliveryTag: 7,
      messageId: 'mid-1',
      appId: 'api-notif',
      headers: {},
      payload: { graphId: 'g1', externalId: 'e1' },
      publishSnippet: data.publishSnippet,
    });
    expect(data.publishSnippet).toContain(`channel.publish(`);
    expect(data.publishSnippet).toContain(
      `Buffer.from(JSON.stringify({"graphId":"g1","externalId":"e1"}))`,
    );
  });

  it('masks sensitive headers and keeps the rest', () => {
    const adapter = new RabbitMqContextAdapter({});
    const profile = adapter.recoverProfile();
    const message = makeMessage({
      properties: {
        headers: { authorization: 'Bearer secret', 'x-uuid': 'trace-id' },
      },
    } as unknown as ConsumeMessage);
    adapter.enrichProfile(profile, makeCtx(message, {}));

    const data = profile.entrypoint.data as RabbitMqInfo;
    expect(data.headers?.authorization).toBe('[REDACTED]');
    expect(data.headers?.['x-uuid']).toBe('trace-id');
  });

  it('omits headers and payload when capture options are disabled', () => {
    const adapter = new RabbitMqContextAdapter({
      captureHeaders: false,
      captureBody: false,
    });
    const profile = adapter.recoverProfile();
    const message = makeMessage({
      properties: { headers: { 'x-uuid': 'trace-id' } },
    } as unknown as ConsumeMessage);
    adapter.enrichProfile(profile, makeCtx(message, { some: 'payload' }));

    const data = profile.entrypoint.data as RabbitMqInfo;
    expect(data.headers).toBeUndefined();
    expect(data.payload).toBeUndefined();
    // The typed marker is always set, regardless of capture options.
    expect(data.routingKey).toBe('published.LEFIGARO');
  });

  it('falls back to defaults for the default exchange', () => {
    const adapter = new RabbitMqContextAdapter({});
    const profile = adapter.recoverProfile();
    const message = makeMessage({
      fields: { exchange: '', routingKey: 'tts.narration', redelivered: true },
    } as unknown as ConsumeMessage);
    adapter.enrichProfile(profile, makeCtx(message, undefined));

    const data = profile.entrypoint.data as RabbitMqInfo;
    expect(data.exchange).toBe('');
    expect(data.routingKey).toBe('tts.narration');
    expect(data.redelivered).toBe(true);
    expect(data.payload).toBeUndefined();
  });
});
