import { isPlainObject } from './type.utils';

describe('isPlainObject', () => {
  it('returns true for a plain object', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isPlainObject(null)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([1, 2, 3])).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isPlainObject('hello')).toBe(false);
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject(true)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });

  it('returns true for a null-prototype object', () => {
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  it('returns false for exotic built-ins and class instances', () => {
    class Foo {}
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject(new Map())).toBe(false);
    expect(isPlainObject(new Set())).toBe(false);
    expect(isPlainObject(/re/)).toBe(false);
    expect(isPlainObject(new Error('x'))).toBe(false);
    expect(isPlainObject(new Foo())).toBe(false);
  });
});
