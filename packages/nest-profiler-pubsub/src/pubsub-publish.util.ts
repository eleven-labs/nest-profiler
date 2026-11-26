import { DEFAULT_MASK_HEADERS, redact, toSafeData } from '@eleven-labs/nest-profiler';
import type { SafeDataOptions } from '@eleven-labs/nest-profiler';

/**
 * Pub/Sub message normalisation, shared by the publish patch and the collector.
 *
 * Exported for unit testing; not part of the package's public API.
 */

/** `projects/<project>/topics/<topic>` — the fully-qualified name a `Topic` reports. */
const TOPIC_PATH = /^projects\/([^/]+)\/topics\/(.+)$/;

/**
 * Stands in for the project id until the client resolved it from the credentials — the
 * `@google-cloud/pubsub` client formats topic names with it in the meantime.
 */
const PROJECT_ID_PLACEHOLDER = '{{projectId}}';

/** A topic split into its short id and, when known, its project. */
export interface TopicName {
  topic: string;
  projectId?: string;
}

/**
 * Splits a topic name into its short id and its project. Accepts the fully-qualified form a
 * `Topic` reports (`projects/my-project/topics/orders`) as well as a bare id (`orders`), and
 * drops the client's `{{projectId}}` placeholder rather than displaying it as a project.
 */
export function parseTopicName(name: string): TopicName {
  const match = TOPIC_PATH.exec(name);
  if (!match) return { topic: name };
  const [, projectId, topic] = match as unknown as [string, string, string];
  return projectId === PROJECT_ID_PLACEHOLDER ? { topic } : { topic, projectId };
}

/** The effective mask list: the core's sensitive header names plus the ones a module option adds. */
export function resolveMaskAttributes(extra: string[] | undefined): string[] {
  return [...DEFAULT_MASK_HEADERS, ...(extra ?? []).map((name) => name.toLowerCase())];
}

/**
 * Copies the message attributes into a flat, JSON-safe record, masking the sensitive ones.
 * Pub/Sub attributes are always strings, so no value formatting is needed beyond `String()`.
 */
export function extractAttributes(
  attributes: Record<string, unknown> | null | undefined,
  maskAttributes: string[],
): Record<string, string> {
  if (!attributes || typeof attributes !== 'object') return {};

  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([, value]) => value != null)
      .map(([key, value]) => [
        key,
        maskAttributes.includes(key.toLowerCase()) ? '[REDACTED]' : String(value),
      ]),
  );
}

/**
 * Projects a published message into something safe to persist and display.
 *
 * `publishMessage()` accepts either a `json` object (serialized by the client) or a `data`
 * buffer. Binary data is decoded as UTF-8 and parsed back to JSON when it holds JSON, so the panel
 * shows the message the way the publisher wrote it rather than a byte array. The result then goes
 * through the core's `toSafeData` (depth/size caps, JSON-serializable) and the shared redaction,
 * so a payload field holding a token or a password never lands in a profile.
 *
 * Returns `undefined` for an attributes-only message — the panel then renders no payload block.
 */
export function capturePublishPayload(
  json: unknown,
  data: unknown,
  limits?: SafeDataOptions,
): unknown {
  let value: unknown;
  if (json != null && typeof json === 'object') {
    value = json;
  } else if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
    value = decodeBinary(Buffer.from(data));
  } else {
    return undefined;
  }

  return redact(toSafeData(value, limits ?? {}));
}

/** Size in bytes of the message body the client will send. */
export function messageSize(json: unknown, data: unknown): number | undefined {
  if (json != null && typeof json === 'object') {
    try {
      return Buffer.byteLength(JSON.stringify(json));
    } catch {
      return undefined;
    }
  }
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) return data.byteLength;
  return undefined;
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
