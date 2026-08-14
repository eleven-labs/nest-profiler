import { buildPublishFingerprint, capturePublishPayload } from './amqp-publish.util';

describe('buildPublishFingerprint', () => {
  it('joins the exchange and the routing key', () => {
    expect(buildPublishFingerprint('articles.events', 'published.LEFIGARO')).toBe(
      'articles.events published.LEFIGARO',
    );
  });

  it('labels the default exchange so an empty name stays readable', () => {
    expect(buildPublishFingerprint('', 'tts.narration')).toBe('(default) tts.narration');
  });

  it('collapses numeric and UUID segments so publishes with different ids group together', () => {
    expect(buildPublishFingerprint('events', 'article.42.published')).toBe(
      'events article.:id.published',
    );
    expect(
      buildPublishFingerprint('events', 'article.7f1d3c2e-4a5b-4c6d-8e9f-0a1b2c3d4e5f.published'),
    ).toBe('events article.:id.published');
  });

  it('keeps segments that merely contain a digit, such as a version marker', () => {
    expect(buildPublishFingerprint('events', 'v2.article.published')).toBe(
      'events v2.article.published',
    );
  });
});

describe('capturePublishPayload', () => {
  it('returns undefined for an empty publish', () => {
    expect(capturePublishPayload(undefined)).toBeUndefined();
    expect(capturePublishPayload(null)).toBeUndefined();
  });

  it('keeps an object payload as structured data', () => {
    expect(capturePublishPayload({ id: 1, nested: { ok: true } })).toEqual({
      id: 1,
      nested: { ok: true },
    });
  });

  it('decodes a Buffer payload and parses it back when it holds JSON', () => {
    expect(capturePublishPayload(Buffer.from(JSON.stringify({ id: 1 })))).toEqual({ id: 1 });
  });

  it('keeps a non-JSON Buffer payload as text', () => {
    expect(capturePublishPayload(Buffer.from('plain text'))).toBe('plain text');
  });

  it('decodes a Uint8Array payload', () => {
    expect(capturePublishPayload(new TextEncoder().encode('{"id":2}'))).toEqual({ id: 2 });
  });

  it('redacts secret-looking fields', () => {
    expect(capturePublishPayload({ password: 'hunter2', id: 1 })).toEqual({
      password: '[REDACTED]',
      id: 1,
    });
  });

  it('applies the configured size caps', () => {
    const captured = capturePublishPayload({ text: 'abcdefghij' }, { maxStringLength: 4 });
    expect(captured).toEqual({ text: 'abcd… [truncated]' });
  });

  it('survives a circular payload rather than throwing', () => {
    const circular: Record<string, unknown> = { id: 1 };
    circular.self = circular;
    expect(capturePublishPayload(circular)).toEqual({ id: 1, self: '[Circular]' });
  });
});
