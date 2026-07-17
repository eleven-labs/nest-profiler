import { toSafeData, safeStringify, normalizeBody } from './safe-data.utils';

describe('toSafeData', () => {
  it('passes through JSON-safe primitives untouched', () => {
    expect(toSafeData('hello')).toBe('hello');
    expect(toSafeData(42)).toBe(42);
    expect(toSafeData(true)).toBe(true);
    expect(toSafeData(null)).toBeNull();
    expect(toSafeData(undefined)).toBeUndefined();
  });

  it('passes through plain objects and arrays', () => {
    expect(toSafeData({ a: 1, b: [2, 'three'] })).toEqual({ a: 1, b: [2, 'three'] });
  });

  it('replaces circular references with [Circular]', () => {
    const value: Record<string, unknown> = { a: 1 };
    value['self'] = value;
    expect(toSafeData(value)).toEqual({ a: 1, self: '[Circular]' });
  });

  it('does not flag shared (non-cyclic) references as circular', () => {
    const shared = { a: 1 };
    expect(toSafeData({ left: shared, right: shared })).toEqual({
      left: { a: 1 },
      right: { a: 1 },
    });
  });

  it('serializes Error as name/message/stack', () => {
    const serialized = toSafeData(new Error('boom'));
    expect(serialized).toMatchObject({ name: 'Error', message: 'boom' });
    expect(JSON.stringify(serialized)).toContain('"stack"');
  });

  it('converts BigInt to string and Date to ISO string', () => {
    expect(toSafeData(BigInt(42))).toBe('42');
    expect(toSafeData(new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02T03:04:05.000Z');
  });

  it('replaces functions, symbols and typed arrays with markers', () => {
    expect(toSafeData(() => 1)).toBe('[Function]');
    expect(toSafeData(Symbol('s'))).toBe('[Symbol]');
    expect(toSafeData(Buffer.from('abcd'))).toBe('[Bytes 4]');
    expect(toSafeData({ fn: () => 1 })).toEqual({ fn: '[Function]' });
  });

  it('converts Map and Set to capped entry arrays', () => {
    expect(toSafeData(new Map([['a', 1]]))).toEqual([['a', 1]]);
    expect(toSafeData(new Set([1, 2]))).toEqual([1, 2]);
  });

  it('serializes URL and RegExp to their string form instead of [Object]', () => {
    expect(toSafeData(new URL('https://example.com/path?q=1'))).toBe(
      'https://example.com/path?q=1',
    );
    expect(toSafeData({ uri: new URL('https://example.com/path') })).toEqual({
      uri: 'https://example.com/path',
    });
    expect(toSafeData(/ab+c/gi)).toBe('/ab+c/gi');
  });

  it('projects a class instance through its toJSON() when present', () => {
    class Money {
      constructor(private readonly amount: number) {}
      toJSON(): { amount: number; currency: string } {
        return { amount: this.amount, currency: 'EUR' };
      }
    }
    expect(toSafeData(new Money(42))).toEqual({ amount: 42, currency: 'EUR' });
  });

  it('enumerates a plain class instance own-enumerable props instead of [Object]', () => {
    class Point {
      constructor(
        public x: number,
        public y: number,
      ) {}
    }
    expect(toSafeData(new Point(1, 2))).toEqual({ x: 1, y: 2 });
  });

  it('collapses values beyond maxDepth', () => {
    const value = { l1: { l2: { l3: [1] } } };
    expect(toSafeData(value, { maxDepth: 2 })).toEqual({ l1: { l2: '[Object]' } });
    expect(toSafeData(value, { maxDepth: 3 })).toEqual({ l1: { l2: { l3: '[Array]' } } });
  });

  it('caps array and object entries with a +N more marker', () => {
    expect(toSafeData([1, 2, 3, 4], { maxItems: 2 })).toEqual([1, 2, '… +2 more']);
    expect(toSafeData({ a: 1, b: 2, c: 3 }, { maxItems: 2 })).toEqual({
      a: 1,
      b: 2,
      '…': '+1 more',
    });
  });

  it('truncates long strings', () => {
    expect(toSafeData('abcdef', { maxStringLength: 4 })).toBe('abcd… [truncated]');
  });

  it('keeps the full value when caps are disabled with 0 or negative', () => {
    const longString = 'x'.repeat(5000);
    const deep = { l1: { l2: { l3: { l4: { l5: [1] } } } } };
    const many = Array.from({ length: 200 }, (_, i) => i);
    const manyKeys = Object.fromEntries(many.map((i) => [`k${i}`, i]));

    expect(toSafeData(longString, { maxStringLength: 0 })).toBe(longString);
    expect(toSafeData(deep, { maxDepth: 0 })).toEqual(deep);
    expect(toSafeData(many, { maxItems: 0 })).toEqual(many);
    expect(toSafeData(many, { maxItems: -1 })).toEqual(many);
    expect(toSafeData(manyKeys, { maxItems: 0 })).toEqual(manyKeys);
    expect(toSafeData(manyKeys, { maxItems: -1 })).toEqual(manyKeys);
    expect(toSafeData({ data: { ok: true } }, { maxItems: 0 })).toEqual({ data: { ok: true } });
  });

  it('always produces JSON-stringifiable output', () => {
    const value: Record<string, unknown> = {
      big: BigInt(1),
      err: new Error('x'),
      map: new Map([[{ k: 1 }, new Set([Symbol('s')])]]),
      when: new Date(),
    };
    value['self'] = value;
    expect(() => JSON.stringify(toSafeData(value))).not.toThrow();
  });
});

describe('normalizeBody', () => {
  it('returns undefined/null unchanged', () => {
    expect(normalizeBody(undefined)).toBeUndefined();
    expect(normalizeBody(null)).toBeNull();
  });

  it('applies the inner content caps forwarded via safeDataOptions', () => {
    const body = { text: 'abcdef', list: [1, 2, 3, 4] };
    expect(normalizeBody(body, 0, { maxStringLength: 4, maxItems: 2 })).toEqual({
      text: 'abcd… [truncated]',
      list: [1, 2, '… +2 more'],
    });
  });

  it('keeps the full body when every cap is disabled', () => {
    const body = { text: 'x'.repeat(5000), list: Array.from({ length: 200 }, (_, i) => i) };
    expect(normalizeBody(body, 0, { maxStringLength: 0, maxItems: 0, maxDepth: 0 })).toEqual(body);
  });

  it('replaces an oversized body with a truncation marker', () => {
    const body = { text: 'y'.repeat(2000) };
    const result = normalizeBody(body, 100) as Record<string, unknown>;
    expect(result._truncated).toBe(true);
    expect(typeof result._bytes).toBe('number');
    expect(result._note).not.toContain('/:token/data');
  });
});

describe('safeStringify', () => {
  it('serializes plain values like JSON.stringify', () => {
    expect(safeStringify({ a: 1 }, 0)).toBe('{"a":1}');
  });

  it('never throws on circular references', () => {
    const value: Record<string, unknown> = { a: 1 };
    value['self'] = value;
    expect(() => safeStringify(value)).not.toThrow();
    expect(safeStringify(value, 0)).toContain('[Circular]');
  });

  it('never throws on BigInt', () => {
    expect(() => safeStringify({ big: BigInt(10) })).not.toThrow();
    expect(safeStringify({ big: BigInt(10) }, 0)).toBe('{"big":"10"}');
  });

  it('does not re-apply size/depth/item caps (data was already bounded at capture)', () => {
    const deep = { data: { products: [{ reviews: [{ id: '1' }, { id: '2' }] }] } };
    expect(JSON.parse(safeStringify(deep, 0))).toEqual(deep);

    const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]));
    const parsedMany = JSON.parse(safeStringify(many, 0)) as Record<string, number>;
    expect(parsedMany).toEqual(many);
    expect('…' in parsedMany).toBe(false);

    const longString = 'x'.repeat(5000);
    expect(JSON.parse(safeStringify({ s: longString }, 0))).toEqual({ s: longString });
  });
});
