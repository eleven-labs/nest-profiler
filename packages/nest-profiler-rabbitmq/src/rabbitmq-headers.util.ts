/**
 * RabbitMQ header normalisation, shared by the consumer adapter (headers read off a
 * `ConsumeMessage`) and the publish patch (headers passed to `AmqpConnection.publish`).
 *
 * The core ships an HTTP-oriented `extractHeaders`; RabbitMQ needs its own because amqplib
 * hands long-string header values back as `Buffer`s, which the HTTP formatter would render
 * as `{"type":"Buffer","data":[…]}` instead of the string the publisher sent.
 *
 * Exported for unit testing; not part of the package's public API.
 */

/** Header names (lowercase) masked by default in captured RabbitMQ headers. */
export const DEFAULT_MASK_HEADERS = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];

/** The effective mask list: the built-in names plus the ones a module option adds. */
export function resolveMaskHeaders(extra: string[] | undefined): string[] {
  return [...DEFAULT_MASK_HEADERS, ...(extra ?? []).map((header) => header.toLowerCase())];
}

/**
 * Formats a single RabbitMQ header value as a display string. Buffers are decoded
 * as UTF-8, arrays are joined, objects are JSON-stringified.
 */
export function formatHeaderValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => formatHeaderValue(item)).join(', ');
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
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

/**
 * Normalizes an RabbitMQ header bag into a flat, JSON-safe, masked record.
 */
export function extractHeaders(headers: unknown, maskHeaders: string[]): Record<string, string> {
  if (!headers || typeof headers !== 'object') return {};

  return Object.fromEntries(
    Object.entries(headers as Record<string, unknown>)
      .filter(
        ([key, value]) => !key.startsWith('_') && value != null && typeof value !== 'function',
      )
      .map(([key, value]) => [
        key,
        maskHeaders.includes(key.toLowerCase()) ? '[REDACTED]' : formatHeaderValue(value),
      ]),
  );
}
