import { extractHeaders, formatHeaderValue, resolveMaskHeaders } from './amqp-headers.util';

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

describe('resolveMaskHeaders', () => {
  it('returns the built-in list when no extra name is given', () => {
    expect(resolveMaskHeaders(undefined)).toEqual([
      'authorization',
      'cookie',
      'x-api-key',
      'x-auth-token',
    ]);
  });

  it('appends the extra names, lowercased so the comparison stays case-insensitive', () => {
    expect(resolveMaskHeaders(['X-Tenant-Secret'])).toContain('x-tenant-secret');
  });
});
