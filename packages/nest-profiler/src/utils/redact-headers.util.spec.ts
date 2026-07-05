import { extractHeaders, formatHeaderValue, DEFAULT_MASK_HEADERS } from './redact-headers.util';

describe('DEFAULT_MASK_HEADERS', () => {
  it('includes the common sensitive headers', () => {
    expect(DEFAULT_MASK_HEADERS).toEqual(
      expect.arrayContaining(['authorization', 'cookie', 'set-cookie']),
    );
  });
});

describe('extractHeaders', () => {
  it('returns an empty object for non-object input', () => {
    expect(extractHeaders(undefined, [])).toEqual({});
    expect(extractHeaders('nope', [])).toEqual({});
  });

  it('uses toJSON() when the header bag provides one', () => {
    const bag = { toJSON: () => ({ 'x-a': '1' }) };
    expect(extractHeaders(bag, [])).toEqual({ 'x-a': '1' });
  });

  it('skips underscore-prefixed, null and function values', () => {
    const result = extractHeaders(
      { _internal: 'x', 'x-null': null, 'x-fn': () => undefined, 'x-ok': 'yes' },
      [],
    );
    expect(result).toEqual({ 'x-ok': 'yes' });
  });

  it('redacts masked headers case-insensitively', () => {
    expect(extractHeaders({ Authorization: 'Bearer s' }, ['authorization'])).toEqual({
      Authorization: '[REDACTED]',
    });
  });

  it('flattens fetch Headers (forEach-style bags)', () => {
    const headers = new Headers({ 'content-type': 'application/json', authorization: 'Bearer s' });
    expect(extractHeaders(headers, ['authorization'])).toEqual({
      'content-type': 'application/json',
      authorization: '[REDACTED]',
    });
  });

  it('flattens a Map header bag', () => {
    const headers = new Map([
      ['x-a', '1'],
      ['x-b', '2'],
    ]);
    expect(extractHeaders(headers, [])).toEqual({ 'x-a': '1', 'x-b': '2' });
  });
});

describe('formatHeaderValue', () => {
  it('joins array values', () => {
    expect(formatHeaderValue(['a', 'b'])).toBe('a, b');
  });

  it('stringifies primitives', () => {
    expect(formatHeaderValue('s')).toBe('s');
    expect(formatHeaderValue(5)).toBe('5');
    expect(formatHeaderValue(true)).toBe('true');
  });

  it('stringifies bigint and symbol', () => {
    expect(formatHeaderValue(BigInt(9))).toBe('9');
    expect(formatHeaderValue(Symbol('sym'))).toBe('sym');
  });

  it('renders Date as ISO string', () => {
    expect(formatHeaderValue(new Date('2026-01-02T03:04:05.000Z'))).toBe(
      '2026-01-02T03:04:05.000Z',
    );
  });

  it('JSON-stringifies plain objects', () => {
    expect(formatHeaderValue({ nested: 1 })).toBe('{"nested":1}');
  });

  it('returns a placeholder for unserializable objects', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(formatHeaderValue(circular)).toBe('[Unserializable object]');
  });

  it('returns a placeholder for values of unknown type', () => {
    expect(formatHeaderValue(undefined)).toBe('[Unknown value]');
  });
});
