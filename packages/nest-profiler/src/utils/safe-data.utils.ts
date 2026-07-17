import { getToJSON, isPlainObject, stringifyExotic } from './type.utils';

export interface SafeDataOptions {
  /** Maximum nesting depth before collapsing to `'[Object]'` / `'[Array]'`. `0` (or negative) disables the cap. */
  maxDepth?: number;
  /** Maximum entries kept per array, object, Map or Set. `0` (or negative) disables the cap. */
  maxItems?: number;
  /** Maximum string length before truncation. `0` (or negative) disables the cap. */
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
  if (maxLength <= 0) return text;
  return text.length > maxLength ? `${text.slice(0, maxLength)}… [truncated]` : text;
}

function serializeError(error: Error, maxLength: number): Record<string, unknown> {
  return {
    name: error.name,
    message: truncate(error.message, maxLength),
    ...(error.stack === undefined ? {} : { stack: truncate(error.stack, maxLength) }),
  };
}

/** Sanitizes own-enumerable entries, keeping up to `maxItems` and marking the rest as `'…': '+N more'`. */
function sanitizeEntries(
  entries: [string, unknown][],
  child: (item: unknown) => unknown,
  maxItems: number,
): Record<string, unknown> {
  const kept = maxItems > 0 ? entries.slice(0, maxItems) : entries;
  const result = Object.fromEntries(
    kept.map(([key, entry]): [string, unknown] => [key, child(entry)]),
  );
  if (maxItems > 0 && entries.length > maxItems) {
    result['…'] = `+${entries.length - maxItems} more`;
  }
  return result;
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
    if (maxItems > 0 && items.length >= maxItems) {
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
  const exotic = stringifyExotic(value);
  if (exotic !== undefined) {
    return truncate(exotic, options.maxStringLength);
  }
  if (ArrayBuffer.isView(value)) {
    return `[Bytes ${value.byteLength}]`;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  if (options.maxDepth > 0 && depth >= options.maxDepth) {
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
      return sanitizeEntries(Object.entries(value), child, options.maxItems);
    }
    // A remaining class instance: prefer its `toJSON()` projection, else enumerate its
    // own-enumerable props instead of collapsing to `'[Object]'`.
    const toJSON = getToJSON(value);
    if (toJSON) return sanitize(toJSON.call(value), depth, seen, options);
    return sanitizeEntries(
      Object.entries(value as Record<string, unknown>),
      child,
      options.maxItems,
    );
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
 * The inner content caps (string length, item count, depth) are controlled by `safeDataOptions`;
 * each can be disabled by passing `0` (or negative). With every cap disabled (`maxSize <= 0` and
 * unlimited inner caps) the full body is captured verbatim.
 *
 * @param value - The raw captured body.
 * @param maxSize - Max serialized length before truncation. Default {@link DEFAULT_MAX_BODY_SIZE}.
 * @param safeDataOptions - Inner content caps forwarded to {@link toSafeData}.
 */
export function normalizeBody(
  value: unknown,
  maxSize: number = DEFAULT_MAX_BODY_SIZE,
  safeDataOptions: SafeDataOptions = {},
): unknown {
  if (value === undefined || value === null) return value;
  const safe = toSafeData(value, safeDataOptions);
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
    _note:
      'Body truncated at capture time — the full body is not stored. Raise or disable maxBodySize (and the bodyCaptureLimits caps) to capture it in full.',
  };
}

/**
 * `JSON.stringify` that never throws: the value is first passed through {@link toSafeData}
 * so circular references and `BigInt` (which crash `JSON.stringify`) can't break rendering
 * or persistence. Falls back to a diagnostic string if serialization still fails.
 *
 * Size/depth/item caps are disabled here: this serializes data that was already bounded at
 * capture time by `maxBodySize` / `bodyCaptureLimits`, so only the safety conversions apply.
 *
 * @param value - Any value, including cyclic graphs or `BigInt`.
 * @param space - Indentation passed to `JSON.stringify` (default `2`).
 */
export function safeStringify(value: unknown, space: string | number = 2): string {
  try {
    const safe = toSafeData(value, { maxDepth: 0, maxItems: 0, maxStringLength: 0 });
    return JSON.stringify(safe, null, space) ?? String(value);
  } catch {
    return '[Unserializable value]';
  }
}
