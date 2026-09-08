import { REDACTED } from './redact.utils';

/**
 * Transport-agnostic header redaction helpers shared by the core middleware and every
 * HTTP instrumentation.
 *
 * These only deal with plain header bags (or objects exposing a `toJSON()`), so they work
 * the same for a Node.js `IncomingHttpHeaders`, axios `AxiosHeaders`, a `fetch` `Headers`
 * snapshot, or a hand-built record.
 */

export const DEFAULT_MASK_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
];

/** Optional behaviours of {@link extractHeaders}. */
export interface ExtractHeadersOptions {
  /**
   * Written in place of a masked value. Defaults to `[REDACTED]`; the core passes the host's
   * configured `redaction.replacement` so masking reads the same everywhere.
   */
  replacement?: string;
  /**
   * Keep a multi-value header as an array instead of joining its values with `', '`. Set by the
   * core's request/response capture, whose profile fields are typed `string | string[]`: joining
   * a repeated `set-cookie` would merge two cookies into one unusable line (their `Expires`
   * dates contain commas). The instrumentation panels, which render a display string, leave it off.
   */
  multiValue?: boolean;
}

/**
 * Normalises a header bag into a flat record, masking the values of `maskHeaders` (compared
 * case-insensitively). Underscore-prefixed, null and function values are skipped.
 *
 * The single header normaliser in the codebase: the core middleware (incoming request), the core
 * interceptor (outgoing response) and every HTTP instrumentation go through it, so a header masked
 * on the way in cannot be readable on the way out, and every transport's bag shape — a Node
 * `IncomingHttpHeaders`, an axios `AxiosHeaders`, a `fetch` `Headers`, a `Map` — is understood in
 * one place.
 */
export function extractHeaders(
  headers: unknown,
  maskHeaders: Iterable<string>,
  options: ExtractHeadersOptions & { multiValue: true },
): Record<string, string | string[]>;
export function extractHeaders(
  headers: unknown,
  maskHeaders: Iterable<string>,
  options?: ExtractHeadersOptions,
): Record<string, string>;
export function extractHeaders(
  headers: unknown,
  maskHeaders: Iterable<string>,
  options: ExtractHeadersOptions = {},
): Record<string, string | string[]> {
  if (!headers || typeof headers !== 'object') return {};

  const raw = normalizeHeaderBag(headers);
  const masked = new Set([...maskHeaders].map((h) => h.toLowerCase()));
  const replacement = options.replacement ?? REDACTED;

  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('_') || value == null || typeof value === 'function') continue;
    if (masked.has(key.toLowerCase())) {
      result[key] = replacement;
    } else if (options.multiValue && Array.isArray(value)) {
      result[key] = value.map((item) => formatHeaderValue(item));
    } else {
      result[key] = formatHeaderValue(value);
    }
  }
  return result;
}

/**
 * Flattens a header bag into a plain record. Supports objects exposing `toJSON()`
 * (axios `AxiosHeaders`), iterable bags with a `forEach((value, key))` (`fetch` `Headers`,
 * `Map`), and plain records.
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

/** Renders an arbitrary header value as a display string. */
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
