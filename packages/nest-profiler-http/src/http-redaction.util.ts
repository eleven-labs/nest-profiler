/**
 * Client-agnostic header redaction helpers shared by HTTP instrumentations.
 *
 * These only deal with plain header bags (or objects exposing a `toJSON()`),
 * so they work the same for axios `AxiosHeaders`, a `fetch` `Headers` snapshot,
 * or a hand-built record.
 */

export const DEFAULT_MASK_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
];

/**
 * Normalises a header bag into a flat `Record<string, string>`, masking the
 * values of `maskHeaders` (compared case-insensitively) with `[REDACTED]`.
 * Underscore-prefixed, null and function values are skipped.
 */
export function extractHeaders(headers: unknown, maskHeaders: string[]): Record<string, string> {
  if (!headers || typeof headers !== 'object') return {};

  const raw = normalizeHeaderBag(headers);

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('_') || value == null || typeof value === 'function') continue;
    const strValue = formatHeaderValue(value);
    result[key] = maskHeaders.includes(key.toLowerCase()) ? '[REDACTED]' : strValue;
  }
  return result;
}

/**
 * Flattens a header bag into a plain record. Supports objects exposing
 * `toJSON()` (axios `AxiosHeaders`), iterable bags with a `forEach((value, key))`
 * (`fetch` `Headers`, `Map`), and plain records.
 */
function normalizeHeaderBag(headers: object): Record<string, unknown> {
  const withToJson = headers as { toJSON?: () => Record<string, unknown> };
  if (typeof withToJson.toJSON === 'function') return withToJson.toJSON();

  const iterable = headers as { forEach?: (cb: (value: unknown, key: string) => void) => void };
  if (typeof iterable.forEach === 'function' && !Array.isArray(headers)) {
    const out: Record<string, unknown> = {};
    iterable.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }

  return headers as Record<string, unknown>;
}

/**
 * Renders an arbitrary header value as a display string.
 */
export function formatHeaderValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => formatHeaderValue(item)).join(', ');
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'symbol') {
    return value.description ?? value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[Unserializable object]';
    }
  }

  return '[Unknown value]';
}
