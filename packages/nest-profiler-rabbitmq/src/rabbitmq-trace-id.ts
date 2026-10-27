import { DEFAULT_TRACE_ID_HEADER, isAdoptableTraceId } from '@eleven-labs/nest-profiler';
import type { Options } from 'amqplib';
import { formatHeaderValue } from './rabbitmq-headers.util.js';

/**
 * Trace id propagation over AMQP, shared by the publish patch (which writes the header) and the
 * consumer adapter (which reads it back).
 *
 * A header rather than the `correlationId` property: golevelup's RPC (`AmqpConnection.request()`)
 * owns `correlationId` to match a reply to its request, so the trace id cannot travel there without
 * breaking RPC — and an RPC handler would otherwise open a trace of its own.
 *
 * Exported for unit testing; not part of the package's public API.
 */

/**
 * The header a published message should carry the trace id on, or `undefined` when propagation is
 * off.
 *
 * @param option - The module's `propagateTraceId`: `true` for the default header, a string for a
 *   custom one, anything falsy to leave the application's messages untouched.
 */
export function resolveTraceIdHeader(option: boolean | string | undefined): string | undefined {
  if (option === true) return DEFAULT_TRACE_ID_HEADER;
  if (typeof option === 'string' && option.trim()) return option.trim().toLowerCase();
  return undefined;
}

/** The key of `headers` matching `header`, compared case-insensitively. */
function findHeaderKey(headers: unknown, header: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const lower = header.toLowerCase();
  return Object.keys(headers).find((key) => key.toLowerCase() === lower);
}

/**
 * The publish options with the trace id added as `header`, or the caller's options untouched when
 * there is nothing to add.
 *
 * An explicit value always wins: a message that already carries the header keeps it, since the
 * caller set it on purpose. The caller's options object is never mutated — it may be a shared
 * constant reused across publishes.
 */
export function withTraceIdHeader(
  publishOptions: Options.Publish | undefined,
  header: string | undefined,
  traceId: string | undefined,
): Options.Publish | undefined {
  if (!header || !traceId) return publishOptions;
  const headers = publishOptions?.headers as Record<string, unknown> | undefined;
  if (findHeaderKey(headers, header) !== undefined) return publishOptions;
  return { ...publishOptions, headers: { ...headers, [header]: traceId } };
}

/**
 * The trace id a consumed message carries on `header`, or `undefined` when it carries none — or one
 * not fit to adopt. Validated like any inbound id: it lands in log lines and in the dashboard, so it
 * is not trusted on the publisher's word.
 */
export function readMessageTraceId(headers: unknown, header: string): string | undefined {
  const key = findHeaderKey(headers, header);
  if (key === undefined) return undefined;
  const value = formatHeaderValue((headers as Record<string, unknown>)[key]);
  return isAdoptableTraceId(value) ? value : undefined;
}
