import type { ClientRequest, IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { monotonicNow } from '@eleven-labs/nest-profiler';
import type { HttpPhases } from '../http-phases.interface';
import { hasHttpPhases } from '../http-phases.interface';
import { phaseSpan } from './phase-clock';

/**
 * Monotonic marks taken from a `ClientRequest`'s own lifecycle events. Kept as marks rather than
 * durations until they are read, because a phase is a difference between two of them and which
 * two depends on what actually happened — a reused connection never emits `lookup`/`connect`.
 */
interface RequestMarks {
  start: number;
  socket?: number;
  lookup?: number;
  connect?: number;
  secureConnect?: number;
  upload?: number;
  response?: number;
  end?: number;
}

/**
 * Marks are held off to the side, keyed weakly by the request, rather than stamped as a property
 * on it: the request belongs to the application (or to `follow-redirects`, or to nock), and a
 * profiler that decorates foreign objects is a profiler that changes what it observes.
 */
const marks = new WeakMap<ClientRequest, RequestMarks>();

/**
 * Time one `node:http` / `node:https` request, by listening to the events it already emits.
 *
 * Call it on a freshly created `ClientRequest` — the `socket` event is deferred to the next tick,
 * so instrumenting straight after `http.request(...)` is always in time. Nothing is read from the
 * request or the response: only event *instants* are recorded, so the response stream is never
 * touched and cannot be put into flowing mode behind the caller's back.
 *
 * Idempotent. Read the result back with {@link phasesOfClientRequest}, or let
 * `readHttpPhases` find it from whatever object you happen to hold.
 *
 * ```ts
 * // A client that hands you its underlying request (got, superagent…):
 * got.stream(url).on('request', (req) => instrumentClientRequest(req));
 * ```
 */
export function instrumentClientRequest(request: ClientRequest): void {
  if (marks.has(request)) return;

  const taken: RequestMarks = { start: monotonicNow() };
  marks.set(request, taken);

  const onSocket = (socket: Socket): void => {
    taken.socket ??= monotonicNow();
    socket.prependOnceListener('lookup', () => void (taken.lookup = monotonicNow()));
    socket.prependOnceListener('connect', () => void (taken.connect = monotonicNow()));
    socket.prependOnceListener('secureConnect', () => void (taken.secureConnect = monotonicNow()));
  };

  // Defensive: a pooled socket assigned synchronously would have fired before we subscribed.
  if (request.socket) onSocket(request.socket);
  else request.prependOnceListener('socket', onSocket);

  request.prependOnceListener('finish', () => void (taken.upload = monotonicNow()));

  request.prependOnceListener('response', (response: IncomingMessage) => {
    taken.response = monotonicNow();
    response.prependOnceListener('end', () => void (taken.end ??= monotonicNow()));
    response.prependOnceListener('aborted', () => void (taken.end ??= monotonicNow()));
    response.prependOnceListener('error', () => void (taken.end ??= monotonicNow()));
  });

  request.prependOnceListener('error', () => void (taken.end ??= monotonicNow()));
}

/** The phases measured for an instrumented request, or `undefined` if it was never timed. */
export function phasesOfClientRequest(request: ClientRequest): HttpPhases | undefined {
  const taken = marks.get(request);
  return taken ? derivePhases(taken) : undefined;
}

/** Whether this request is being timed — used by the node:http provider to stay idempotent. */
export function isInstrumentedClientRequest(request: ClientRequest): boolean {
  return marks.has(request);
}

/**
 * Turns marks into durations, skipping any phase whose two ends were not both observed.
 *
 * The upload mark is clamped forward onto the connection: `finish` fires when the body is flushed
 * to the socket, which for a small payload on a fresh connection happens *before* the handshake
 * completed. Left alone that yields a negative `request` phase; clamped, the time lands in
 * `firstByte`, which is where the waiting genuinely was.
 */
function derivePhases(taken: RequestMarks): HttpPhases | undefined {
  const phases: HttpPhases = {};
  const { start, socket, lookup, connect, secureConnect, response, end } = taken;

  if (socket !== undefined) phases.wait = phaseSpan(start, socket);
  if (socket !== undefined && lookup !== undefined) phases.dns = phaseSpan(socket, lookup);

  const tcpStart = lookup ?? socket;
  if (tcpStart !== undefined && connect !== undefined) phases.tcp = phaseSpan(tcpStart, connect);
  if (connect !== undefined && secureConnect !== undefined) {
    phases.tls = phaseSpan(connect, secureConnect);
  }

  const connectedAt = secureConnect ?? connect ?? socket;
  const upload =
    taken.upload !== undefined && connectedAt !== undefined
      ? Math.max(taken.upload, connectedAt)
      : taken.upload;

  if (connectedAt !== undefined && upload !== undefined) {
    phases.request = phaseSpan(connectedAt, upload);
  }

  const firstByteFrom = upload ?? connectedAt;
  if (firstByteFrom !== undefined && response !== undefined) {
    phases.firstByte = phaseSpan(firstByteFrom, response);
  }
  if (response !== undefined && end !== undefined) phases.download = phaseSpan(response, end);

  return hasHttpPhases(phases) ? phases : undefined;
}
