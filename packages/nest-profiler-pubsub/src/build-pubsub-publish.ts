/** The fields {@link buildPubSubPublish} reads — satisfied by `PubSubPublishEntry`. */
export interface PubSubPublishSnippetInput {
  topic: string;
  payload?: unknown;
  attributes?: Record<string, string>;
  orderingKey?: string;
}

/**
 * Builds a runnable `@google-cloud/pubsub` snippet that re-publishes the message, mirroring the
 * Symfony Web Profiler "copy" affordance.
 *
 * A JSON payload is passed as `json` (the client serializes it), a plain-text one as a `data`
 * buffer; attributes and the ordering key are included when present. Masked attributes are
 * copied as masked — the snippet never carries a value the profile did not store.
 *
 * Exported for unit testing; not part of the package's public API.
 */
export function buildPubSubPublish(info: PubSubPublishSnippetInput): string {
  const fields: string[] = [];

  if (typeof info.payload === 'string') {
    fields.push(`data: Buffer.from(${JSON.stringify(info.payload)})`);
  } else if (info.payload !== undefined) {
    fields.push(`json: ${indent(JSON.stringify(info.payload, null, 2))}`);
  }
  if (info.attributes && Object.keys(info.attributes).length > 0) {
    fields.push(`attributes: ${indent(JSON.stringify(info.attributes, null, 2))}`);
  }
  if (info.orderingKey) fields.push(`orderingKey: ${JSON.stringify(info.orderingKey)}`);

  const message = fields.length > 0 ? `{\n  ${fields.join(',\n  ')},\n}` : '{}';
  return `await pubsub.topic(${JSON.stringify(info.topic)}).publishMessage(${message});`;
}

/** Indents the continuation lines of a pretty-printed value to sit inside the message literal. */
function indent(value: string): string {
  return value.replace(/\n/g, '\n  ');
}
