import { redact, toSafeData } from '@eleven-labs/nest-profiler';
import type { SafeDataOptions } from '@eleven-labs/nest-profiler';

/** A routing-key segment that is a UUID — an identifier, not part of the message's shape. */
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A purely numeric routing-key segment (`article.42.published`). */
const NUMERIC_SEGMENT = /^\d+$/;

/** Label standing in for the RabbitMQ default exchange (an empty exchange name). */
const DEFAULT_EXCHANGE_LABEL = '(default)';

/**
 * Builds the fingerprint used to group repeated publishes: `exchange routingKey`, with the
 * routing key's identifier segments collapsed to `:id`.
 *
 * Without that normalization a routing key carrying an id (`article.42.published`) would never
 * group, and the N+1 rule — the same message published once per loop iteration — would stay
 * silent. Segments are matched whole (dot-delimited), so a version marker like `v2` survives.
 *
 * Exported for unit testing; not part of the package's public API.
 */
export function buildPublishFingerprint(exchange: string, routingKey: string): string {
  const normalized = routingKey
    .split('.')
    .map((segment) =>
      UUID_SEGMENT.test(segment) || NUMERIC_SEGMENT.test(segment) ? ':id' : segment,
    )
    .join('.');

  return `${exchange || DEFAULT_EXCHANGE_LABEL} ${normalized}`;
}

/**
 * Projects a published message into something safe to persist and display.
 *
 * `AmqpConnection.publish` accepts an object (serialized by the connection's serializer, JSON
 * by default), a `Buffer`/`Uint8Array` (published verbatim) or nothing. Binary payloads are
 * decoded as UTF-8 and parsed back to JSON when they hold JSON, so the panel shows the message
 * the way the publisher wrote it rather than a byte array. The result then goes through the
 * core's `toSafeData` (depth/size caps, JSON-serializable) and the shared redaction, so a
 * payload field holding a token or a password never lands in a profile.
 *
 * Returns `undefined` for an empty publish — the panel then renders no payload block.
 *
 * Exported for unit testing; not part of the package's public API.
 */
export function capturePublishPayload(message: unknown, limits?: SafeDataOptions): unknown {
  if (message == null) return undefined;

  const value =
    Buffer.isBuffer(message) || message instanceof Uint8Array
      ? decodeBinary(Buffer.from(message))
      : message;

  return redact(toSafeData(value, limits ?? {}));
}

/** Decodes a binary payload as UTF-8, parsed back to JSON when it holds JSON. */
function decodeBinary(buffer: Buffer): unknown {
  const text = buffer.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
