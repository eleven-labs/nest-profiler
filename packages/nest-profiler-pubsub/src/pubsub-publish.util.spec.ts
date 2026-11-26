import {
  capturePublishPayload,
  extractAttributes,
  messageSize,
  parseTopicName,
  resolveMaskAttributes,
} from './pubsub-publish.util.js';

describe('parseTopicName', () => {
  it('splits a fully-qualified topic name into its project and short id', () => {
    expect(parseTopicName('projects/my-project/topics/orders')).toEqual({
      topic: 'orders',
      projectId: 'my-project',
    });
  });

  it('keeps a bare topic id as is', () => {
    expect(parseTopicName('orders')).toEqual({ topic: 'orders' });
  });

  it('drops the placeholder the client uses until the project id is resolved', () => {
    expect(parseTopicName('projects/{{projectId}}/topics/orders')).toEqual({ topic: 'orders' });
  });
});

describe('extractAttributes', () => {
  const mask = resolveMaskAttributes(['x-tenant-secret']);

  it('copies the attributes as strings', () => {
    expect(extractAttributes({ eventType: 'order.created', version: '2' }, mask)).toEqual({
      eventType: 'order.created',
      version: '2',
    });
  });

  it('masks the built-in sensitive names and the extra ones, case-insensitively', () => {
    expect(
      extractAttributes(
        { Authorization: 'Bearer abc', 'X-Tenant-Secret': 's3cr3t', ok: 'yes' },
        mask,
      ),
    ).toEqual({ Authorization: '[REDACTED]', 'X-Tenant-Secret': '[REDACTED]', ok: 'yes' });
  });

  it('returns an empty record for missing attributes and skips nullish values', () => {
    expect(extractAttributes(undefined, mask)).toEqual({});
    expect(extractAttributes(null, mask)).toEqual({});
    expect(extractAttributes({ a: null, b: 'x' }, mask)).toEqual({ b: 'x' });
  });
});

describe('capturePublishPayload', () => {
  it('captures a json message as an object', () => {
    expect(capturePublishPayload({ id: 1 }, undefined)).toEqual({ id: 1 });
  });

  it('prefers json over data, as the client does', () => {
    expect(capturePublishPayload({ id: 1 }, Buffer.from('ignored'))).toEqual({ id: 1 });
  });

  it('parses a JSON buffer back to an object', () => {
    expect(capturePublishPayload(undefined, Buffer.from('{"id":42}'))).toEqual({ id: 42 });
  });

  it('decodes a non-JSON buffer as text', () => {
    expect(capturePublishPayload(undefined, Buffer.from('hello'))).toBe('hello');
  });

  it('accepts a Uint8Array', () => {
    expect(capturePublishPayload(undefined, new TextEncoder().encode('"quoted"'))).toBe('quoted');
  });

  it('redacts sensitive fields', () => {
    expect(capturePublishPayload({ password: 'hunter2', id: 1 }, undefined)).toMatchObject({
      id: 1,
      password: '[REDACTED]',
    });
  });

  it('returns undefined for an attributes-only message', () => {
    expect(capturePublishPayload(undefined, undefined)).toBeUndefined();
    expect(capturePublishPayload(null, null)).toBeUndefined();
  });
});

describe('messageSize', () => {
  it('measures the serialized json', () => {
    expect(messageSize({ id: 1 }, undefined)).toBe(8);
  });

  it('measures a buffer in bytes, not characters', () => {
    expect(messageSize(undefined, Buffer.from('é'))).toBe(2);
  });

  it('returns undefined without a body, or for an unserializable json', () => {
    expect(messageSize(undefined, undefined)).toBeUndefined();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(messageSize(circular, undefined)).toBeUndefined();
  });
});
