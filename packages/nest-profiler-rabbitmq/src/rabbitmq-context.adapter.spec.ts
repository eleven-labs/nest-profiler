import type { ExecutionContext } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';
import {
  RabbitMqContextAdapter,
  extractHeaders,
  formatHeaderValue,
} from './rabbitmq-context.adapter';
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

describe('extractHeaders', () => {
  it('returns an empty object for non-object input', () => {
    expect(extractHeaders(undefined, [])).toEqual({});
    expect(extractHeaders('nope', [])).toEqual({});
  });

  it('skips underscore-prefixed, null and function values', () => {
    const result = extractHeaders(
      { _x: 'a', 'x-null': null, 'x-fn': () => undefined, 'x-ok': 'yes' },
      [],
    );
    expect(result).toEqual({ 'x-ok': 'yes' });
  });

  it('joins array values', () => {
    expect(extractHeaders({ 'x-list': ['a', 'b'] }, [])).toEqual({
      'x-list': 'a, b',
    });
  });

  it('redacts masked headers case-insensitively', () => {
    expect(extractHeaders({ Authorization: 'x' }, ['authorization'])).toEqual({
      Authorization: '[REDACTED]',
    });
  });
});

describe('formatHeaderValue', () => {
  it('converts Buffers to utf8 strings', () => {
    expect(formatHeaderValue(Buffer.from('hello'))).toBe('hello');
  });

  it('stringifies primitives and bigint', () => {
    expect(formatHeaderValue('s')).toBe('s');
    expect(formatHeaderValue(5)).toBe('5');
    expect(formatHeaderValue(true)).toBe('true');
    expect(formatHeaderValue(BigInt(9))).toBe('9');
  });

  it('joins array values', () => {
    expect(formatHeaderValue(['a', 1, true])).toBe('a, 1, true');
  });

  it('renders Dates as ISO strings', () => {
    const date = new Date('2026-06-16T00:00:00.000Z');
    expect(formatHeaderValue(date)).toBe('2026-06-16T00:00:00.000Z');
  });

  it('JSON-stringifies plain objects', () => {
    expect(formatHeaderValue({ nested: 1 })).toBe('{"nested":1}');
  });

  it('returns a placeholder for unserializable objects', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatHeaderValue(circular)).toBe('[Unserializable object]');
  });

  it('returns a placeholder for values of unknown type', () => {
    expect(formatHeaderValue(undefined)).toBe('[Unknown value]');
  });
});
