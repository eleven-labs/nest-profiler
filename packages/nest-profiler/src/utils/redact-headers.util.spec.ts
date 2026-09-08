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

describe('extractHeaders options', () => {
  it('accepts any iterable of masked names, not just an array', () => {
    expect(extractHeaders({ Authorization: 'Bearer s' }, new Set(['authorization']))).toEqual({
      Authorization: '[REDACTED]',
    });
  });

  it('writes the replacement given by the caller in place of the default sentinel', () => {
    expect(
      extractHeaders({ authorization: 'Bearer s' }, ['authorization'], { replacement: '***' }),
    ).toEqual({ authorization: '***' });
  });

  it('joins a multi-value header by default', () => {
    expect(extractHeaders({ 'x-fwd': ['a', 'b'] }, [])).toEqual({ 'x-fwd': 'a, b' });
  });

  it('keeps a multi-value header as an array under multiValue', () => {
    expect(extractHeaders({ 'x-fwd': ['a', 'b'] }, [], { multiValue: true })).toEqual({
      'x-fwd': ['a', 'b'],
    });
  });

  it('still masks a multi-value header with a single replacement under multiValue', () => {
    expect(
      extractHeaders({ 'set-cookie': ['a=1', 'b=2'] }, ['set-cookie'], { multiValue: true }),
    ).toEqual({ 'set-cookie': '[REDACTED]' });
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
