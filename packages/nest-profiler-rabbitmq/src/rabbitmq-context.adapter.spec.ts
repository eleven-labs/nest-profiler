import type { ExecutionContext } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';
import { RabbitMqContextAdapter } from './rabbitmq-context.adapter.js';
import { RABBITMQ_ENTRYPOINT_TYPE } from './rabbitmq-collector.interface.js';
import type { RabbitMqInfo } from './rabbitmq-collector.interface.js';

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

  describe('trace id adoption', () => {
    /** Enriches a fresh profile from a message carrying `properties`; returns its trace id. */
    function adoptedTraceId(
      properties: Record<string, unknown>,
      adapter = new RabbitMqContextAdapter({}),
    ): { generated: string; adopted: string } {
      const profile = adapter.recoverProfile();
      const generated = profile.traceId;
      const message = makeMessage({ properties } as unknown as ConsumeMessage);
      adapter.enrichProfile(profile, makeCtx(message, {}));
      return { generated, adopted: profile.traceId };
    }

    it('keeps its own trace when the message carries no trace id', () => {
      const { generated, adopted } = adoptedTraceId({ headers: {} });
      expect(adopted).toBe(generated);
    });

    it('adopts the trace id header the publisher added', () => {
      expect(adoptedTraceId({ headers: { 'x-request-id': 'trace-1' } }).adopted).toBe('trace-1');
    });

    it('reads a header amqplib handed back as a Buffer', () => {
      const headers = { 'x-request-id': Buffer.from('trace-1') };
      expect(adoptedTraceId({ headers }).adopted).toBe('trace-1');
    });

    it('prefers the header over the correlationId golevelup sets on an RPC call', () => {
      const properties = { headers: { 'x-request-id': 'trace-1' }, correlationId: 'rpc-1' };
      expect(adoptedTraceId(properties).adopted).toBe('trace-1');
    });

    it('falls back to the correlationId when the header is absent', () => {
      expect(adoptedTraceId({ headers: {}, correlationId: 'trace-1' }).adopted).toBe('trace-1');
    });

    it('reads a custom header name, whatever its case', () => {
      const adapter = new RabbitMqContextAdapter({ traceIdHeader: 'x-correlation-id' });
      const headers = { 'X-Correlation-Id': 'trace-1', 'x-request-id': 'other' };
      expect(adoptedTraceId({ headers }, adapter).adopted).toBe('trace-1');
    });

    it('rejects a trace id unfit to adopt', () => {
      const { generated, adopted } = adoptedTraceId({
        headers: { 'x-request-id': '<script>' },
        correlationId: 'a b',
      });
      expect(adopted).toBe(generated);
    });
  });
});
