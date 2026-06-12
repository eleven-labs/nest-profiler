import { toSafeData } from './safe-data.utils';

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
