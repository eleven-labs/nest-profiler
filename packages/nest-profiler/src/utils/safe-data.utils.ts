import { isPlainObject } from './type.utils';

export interface SafeDataOptions {
  /** Maximum nesting depth before collapsing to `'[Object]'` / `'[Array]'`. */
  maxDepth?: number;
  /** Maximum entries kept per array, object, Map or Set. */
  maxItems?: number;
  /** Maximum string length before truncation. */
  maxStringLength?: number;
}

const DEFAULT_OPTIONS: Required<SafeDataOptions> = {
  maxDepth: 4,
  maxItems: 64,
  maxStringLength: 2048,
};

function truncate(value: unknown, maxLength: number): string {
  // Guard against type confusion (CWE-843): captured request data can reach this sink as an
  // array instead of a string (e.g. a tampered `?x=a&x=b` query parameter), which would make
  // `.length`/`.slice` behave unexpectedly. Coerce anything non-string before operating on it.
  const text = typeof value === 'string' ? value : String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}… [truncated]` : text;
}

function serializeError(error: Error, maxLength: number): Record<string, unknown> {
  return {
    name: error.name,
    message: truncate(error.message, maxLength),
    ...(error.stack === undefined ? {} : { stack: truncate(error.stack, maxLength) }),
  };
}

/** Maps up to `maxItems` items, then appends a `… +N more` marker for the rest. */
function capItems<T>(
  iterable: Iterable<T>,
  total: number,
  maxItems: number,
  map: (item: T) => unknown,
): unknown[] {
  const items: unknown[] = [];
  for (const item of iterable) {
    if (items.length >= maxItems) {
      items.push(`… +${total - maxItems} more`);
      break;
    }
    items.push(map(item));
  }
  return items;
}

function sanitize(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  options: Required<SafeDataOptions>,
): unknown {
  switch (typeof value) {
    case 'string':
      return truncate(value, options.maxStringLength);
    case 'number':
    case 'boolean':
    case 'undefined':
      return value;
    case 'bigint':
      return String(value);
    case 'function':
      return '[Function]';
    case 'symbol':
      return '[Symbol]';
  }
  if (value === null || typeof value !== 'object') {
    return null;
  }
  if (value instanceof Error) {
    return serializeError(value, options.maxStringLength);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (ArrayBuffer.isView(value)) {
    return `[Bytes ${value.byteLength}]`;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  if (depth >= options.maxDepth) {
    return Array.isArray(value) ? '[Array]' : '[Object]';
  }
  seen.add(value);
  try {
    const child = (item: unknown): unknown => sanitize(item, depth + 1, seen, options);
    if (Array.isArray(value)) {
      return capItems(value, value.length, options.maxItems, child);
    }
    if (value instanceof Map) {
      return capItems(value, value.size, options.maxItems, ([key, entry]) => [
        child(key),
        child(entry),
      ]);
    }
    if (value instanceof Set) {
      return capItems(value, value.size, options.maxItems, child);
    }
    if (isPlainObject(value)) {
      const entries = Object.entries(value);
      const result = Object.fromEntries(
        entries
          .slice(0, options.maxItems)
          .map(([key, entry]): [string, unknown] => [key, child(entry)]),
      );
      if (entries.length > options.maxItems) {
        result['…'] = `+${entries.length - options.maxItems} more`;
      }
      return result;
    }
    return '[Object]';
  } finally {
    seen.delete(value);
  }
}

/**
 * Converts any value into a JSON-serializable equivalent so profiles always persist:
 * circular references, `Error`, `BigInt`, `Date`, `Map`/`Set` and typed arrays are replaced
 * by safe representations, and depth/size/string-length caps keep payloads bounded.
 */
export function toSafeData(value: unknown, options: SafeDataOptions = {}): unknown {
  return sanitize(value, 0, new WeakSet(), {
    maxDepth: options.maxDepth ?? DEFAULT_OPTIONS.maxDepth,
    maxItems: options.maxItems ?? DEFAULT_OPTIONS.maxItems,
    maxStringLength: options.maxStringLength ?? DEFAULT_OPTIONS.maxStringLength,
  });
}

/** Default cap (in characters of serialized JSON) for a captured request/response body. */
export const DEFAULT_MAX_BODY_SIZE = 64 * 1024;

/**
 * Normalises a captured body for safe storage and rendering: it is made JSON-safe via
 * {@link toSafeData} (so circular refs / `BigInt` can't crash persistence or the detail page)
 * and, if its serialized form exceeds `maxSize` characters, replaced by a truncation marker
 * carrying a short preview. Pass `maxSize <= 0` to disable the size cap.
 *
 * @param value - The raw captured body.
 * @param maxSize - Max serialized length before truncation. Default {@link DEFAULT_MAX_BODY_SIZE}.
 */
export function normalizeBody(value: unknown, maxSize: number = DEFAULT_MAX_BODY_SIZE): unknown {
  if (value === undefined || value === null) return value;
  const safe = toSafeData(value);
  if (maxSize <= 0) return safe;

  let serialized: string;
  try {
    serialized = JSON.stringify(safe) ?? '';
  } catch {
    return safe;
  }
  if (serialized.length <= maxSize) return safe;

  return {
    _truncated: true,
    _bytes: serialized.length,
    _preview: `${serialized.slice(0, 1024)}…`,
    _note: 'Body truncated — use the raw JSON export (/:token/data) to inspect it in full.',
  };
}

/**
 * `JSON.stringify` that never throws: the value is first passed through {@link toSafeData}
 * so circular references and `BigInt` (which crash `JSON.stringify`) can't break rendering
 * or persistence. Falls back to a diagnostic string if serialization still fails.
 *
 * @param value - Any value, including cyclic graphs or `BigInt`.
 * @param space - Indentation passed to `JSON.stringify` (default `2`).
 */
export function safeStringify(value: unknown, space: string | number = 2): string {
  try {
    return JSON.stringify(toSafeData(value), null, space) ?? String(value);
  } catch {
    return '[Unserializable value]';
  }
}
