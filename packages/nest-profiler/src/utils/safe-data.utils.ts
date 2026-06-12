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

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}… [truncated]` : value;
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
