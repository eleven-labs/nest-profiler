/** Escapes every RegExp metacharacter in `value`, so it matches as literal text. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
