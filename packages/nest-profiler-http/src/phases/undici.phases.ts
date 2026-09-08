import diagnosticsChannel from 'node:diagnostics_channel';
import { Injectable } from '@nestjs/common';
import { monotonicNow } from '@eleven-labs/nest-profiler';
import type { HttpInstrumentation } from '../http-instrumentation.interface';
import type { HttpPhases } from '../http-phases.interface';
import { hasHttpPhases } from '../http-phases.interface';
import { phaseSpan } from './phase-clock';
import { activePhaseSlot, registerPhaseSlotProvider } from './phase-slot';
import type { HttpPhaseSlot } from './phase-slot';

/** A connection whose `connected` never arrives must not grow this queue without bound. */
const MAX_PENDING_CONNECTS = 32;

interface UndiciMarks {
  start: number;
  /** The slot to publish into — the call being recorded around this request, if any. */
  slot?: HttpPhaseSlot;
  /** Coarse dns+tcp+tls duration, attributed from the socket this request was sent on. */
  connect?: number;
  sendHeaders?: number;
  bodySent?: number;
  headers?: number;
  end?: number;
}

/** Keyed by undici's own request object, the identity every request channel carries. */
const requests = new WeakMap<object, UndiciMarks>();
/** A measured connection, waiting for the first request to send headers on its socket. */
const connectedSockets = new WeakMap<object, number>();
/** Connection attempts in flight, per origin, oldest first. */
const pendingConnects = new Map<string, number[]>();

let subscriptions: Array<[string, (message: unknown) => void]> = [];

/**
 * Phases provider for `fetch` and anything else running on **undici** — the HTTP stack behind
 * Node's built-in `fetch`, which does not go through `node:http` and so cannot be timed by
 * `NodeHttpPhases`.
 *
 * It subscribes to undici's `diagnostics_channel` events and never touches the request or the
 * response. Correlation with the call being recorded is exact rather than heuristic: the
 * subscribers run in the async context of the `fetch()` that triggered them, so they find that
 * call's {@link HttpPhaseSlot} — the adapter opens one per call, and nothing is opened at all
 * while no provider is installed.
 *
 * ```ts
 * import { UndiciPhases } from '@eleven-labs/nest-profiler-http/phases';
 *
 * HttpCollectorModule.forRoot({ instrumentations: [FetchInstrumentation, UndiciPhases] });
 * ```
 *
 * Two limits are inherent to what undici reports. Neither is hidden — the panel draws the
 * difference as an explicit remainder:
 *
 * - **the handshake is not broken down.** undici publishes one `connected` event covering DNS,
 *   TCP and TLS, so it is reported as the coarse `connect` phase. A request sent on a pooled
 *   connection reports none, which is correct — it connected nothing.
 * - **`download` is often absent.** `fetch()` resolves as soon as the response *headers* arrive,
 *   which is when the adapter records the call; a body still streaming then has no measured
 *   download phase. Small responses that arrived whole do report one.
 */
@Injectable()
export class UndiciPhases implements HttpInstrumentation {
  install(): void {
    registerPhaseSlotProvider();
    if (subscriptions.length) return;

    subscriptions = [
      ['undici:request:create', onCreate],
      ['undici:client:sendHeaders', onSendHeaders],
      ['undici:request:bodySent', onBodySent],
      ['undici:request:headers', onResponseHeaders],
      ['undici:request:trailers', onComplete],
      ['undici:request:error', onComplete],
      ['undici:client:beforeConnect', onBeforeConnect],
      ['undici:client:connected', onConnected],
      ['undici:client:connectError', onConnectError],
    ];

    for (const [channel, handler] of subscriptions) {
      diagnosticsChannel.subscribe(channel, handler);
    }
  }
}

function onCreate(message: unknown): void {
  const request = objectAt(message, 'request');
  if (!request) return;
  requests.set(request, { start: monotonicNow(), slot: activePhaseSlot() });
}

function onSendHeaders(message: unknown): void {
  const marks = marksOf(message);
  if (!marks) return;
  marks.sendHeaders = monotonicNow();

  // Attribute the connection to the first request that used it: `connected` carries a socket but
  // no request, and a pooled socket is then reused by requests that connected nothing.
  const socket = objectAt(message, 'socket');
  const connect = socket ? connectedSockets.get(socket) : undefined;
  if (socket && connect !== undefined) {
    marks.connect = connect;
    connectedSockets.delete(socket);
  }
  publish(marks);
}

function onBodySent(message: unknown): void {
  const marks = marksOf(message);
  if (!marks) return;
  marks.bodySent = monotonicNow();
  publish(marks);
}

function onResponseHeaders(message: unknown): void {
  const marks = marksOf(message);
  if (!marks) return;
  marks.headers = monotonicNow();
  publish(marks);
}

function onComplete(message: unknown): void {
  const marks = marksOf(message);
  if (!marks) return;
  marks.end ??= monotonicNow();
  publish(marks);
}

function onBeforeConnect(message: unknown): void {
  const key = originKey(message);
  const queue = pendingConnects.get(key) ?? [];
  if (queue.length >= MAX_PENDING_CONNECTS) queue.shift();
  queue.push(monotonicNow());
  pendingConnects.set(key, queue);
}

function onConnected(message: unknown): void {
  const startedAt = takePendingConnect(originKey(message));
  const socket = objectAt(message, 'socket');
  if (startedAt === undefined || !socket) return;
  connectedSockets.set(socket, phaseSpan(startedAt, monotonicNow()));
}

function onConnectError(message: unknown): void {
  takePendingConnect(originKey(message));
}

/** Writes the current breakdown into the slot, so a reader gets the best answer available *now*. */
function publish(marks: UndiciMarks): void {
  if (!marks.slot) return;
  const phases = derivePhases(marks);
  if (phases) marks.slot.phases = phases;
}

/**
 * `wait` is what is left of the pre-send time once the connection is accounted for: undici queues
 * the request, connects if it must, then sends. Starting the wait after the handshake keeps the
 * two segments from claiming the same milliseconds twice.
 */
function derivePhases(marks: UndiciMarks): HttpPhases | undefined {
  const phases: HttpPhases = {};
  const { start, connect, sendHeaders, bodySent, headers, end } = marks;

  if (sendHeaders !== undefined) {
    if (connect !== undefined) phases.connect = connect;
    phases.wait = phaseSpan(start + (connect ?? 0), sendHeaders);
  }
  if (sendHeaders !== undefined && bodySent !== undefined) {
    phases.request = phaseSpan(sendHeaders, bodySent);
  }

  const sentAt = bodySent ?? sendHeaders;
  if (sentAt !== undefined && headers !== undefined) phases.firstByte = phaseSpan(sentAt, headers);
  if (headers !== undefined && end !== undefined) phases.download = phaseSpan(headers, end);

  return hasHttpPhases(phases) ? phases : undefined;
}

function takePendingConnect(key: string): number | undefined {
  const queue = pendingConnects.get(key);
  const startedAt = queue?.shift();
  if (queue?.length === 0) pendingConnects.delete(key);
  return startedAt;
}

/**
 * Connection events carry no request, so they are matched by origin and consumed oldest first.
 * Two concurrent handshakes to the *same* origin can be swapped — both measure a connection to
 * the same host at the same moment, so the reported value stays right to within their difference.
 */
function originKey(message: unknown): string {
  const params = objectAt(message, 'connectParams');
  if (!params) return 'unknown';
  const record = params as Record<string, unknown>;
  const protocol = keyPart(record.protocol) ?? 'http:';
  const host = keyPart(record.hostname) ?? keyPart(record.host) ?? '';
  const port = keyPart(record.port) ?? '';
  return `${protocol}//${host}:${port}`;
}

/** Connection params arrive off a channel message: only a string or a number can key an origin. */
function keyPart(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function marksOf(message: unknown): UndiciMarks | undefined {
  const request = objectAt(message, 'request');
  return request ? requests.get(request) : undefined;
}

function objectAt(message: unknown, key: string): object | undefined {
  if (message == null || typeof message !== 'object') return undefined;
  const value = (message as Record<string, unknown>)[key];
  return value != null && typeof value === 'object' ? value : undefined;
}

/** Test seam: drops every subscription so a suite can install again from a known state. */
export function resetUndiciPhases(): void {
  for (const [channel, handler] of subscriptions) {
    diagnosticsChannel.unsubscribe(channel, handler);
  }
  subscriptions = [];
  pendingConnects.clear();
}
