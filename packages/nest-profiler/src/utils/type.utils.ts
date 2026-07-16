/**
 * Returns true only for a *plain* object — a `{...}` literal or `Object.create(null)` — and
 * false for arrays and exotic/built-in instances (Date, Map, Set, URL, RegExp, Error, Buffer,
 * class instances, …). Callers that enumerate own-enumerable keys rely on this so they never
 * flatten a `Date` to `{}` or a `Buffer` to a byte-index map.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
