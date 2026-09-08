/**
 * Where an outgoing HTTP call spent its time, as a breakdown of **durations in milliseconds**.
 *
 * Durations rather than absolute marks, deliberately: it is the shape a client can actually
 * produce. `node:http` exposes socket events, undici publishes diagnostics-channel events, a
 * bespoke transport may know nothing but its own time-to-first-byte — all three can fill a
 * subset of these fields, whereas none of them agree on a common time base.
 *
 * Every field is optional and there is no requirement that they add up to the call's
 * `duration`: the difference is client-side time (interceptors, serialisation, agent queueing
 * the client never reported) and the panel shows it as an explicit remainder rather than
 * inflating a phase to make the arithmetic look tidy.
 *
 * The names are the de-facto vocabulary — `got`/`@szmarczak/http-timer` use them, and they map
 * onto the browser's `PerformanceResourceTiming`, so a reader coming from either already knows
 * what they mean.
 */
export interface HttpPhases {
  /**
   * Before the transport began connecting or picked a pooled connection: client-side queueing.
   * A saturated agent (`maxSockets` reached) shows up here and nowhere else.
   */
  wait?: number;
  /** DNS resolution. Absent on a reused connection, an IP literal or a cached lookup. */
  dns?: number;
  /** TCP handshake. Absent on a reused connection. */
  tcp?: number;
  /** TLS handshake. Absent on plain HTTP and on a reused connection. */
  tls?: number;
  /**
   * Establishing the connection when the client cannot break it down into {@link dns} /
   * {@link tcp} / {@link tls} — undici reports one "connected" event for the three.
   *
   * Set *instead of* the breakdown, never alongside it: a renderer prefers the breakdown when
   * it is there and falls back to this single segment when it is not.
   */
  connect?: number;
  /** Sending the request, until its last byte left the process. */
  request?: number;
  /** Waiting for the first response byte — upstream think time plus return latency. */
  firstByte?: number;
  /** Streaming the response body, first byte to last. */
  download?: number;
}

/** A key of {@link HttpPhases}. */
export type HttpPhaseName = keyof HttpPhases;

/**
 * The phases in the order they occur, which is the order they are rendered in. `connect` sits
 * where the handshake it stands for would have been.
 */
export const HTTP_PHASE_SEQUENCE: readonly HttpPhaseName[] = [
  'wait',
  'dns',
  'tcp',
  'tls',
  'connect',
  'request',
  'firstByte',
  'download',
];

/** Human labels for the phases, shared by the panel and any custom rendering. */
export const HTTP_PHASE_LABELS: Readonly<Record<HttpPhaseName, string>> = {
  wait: 'Wait',
  dns: 'DNS',
  tcp: 'TCP',
  tls: 'TLS',
  connect: 'Connect',
  request: 'Request',
  firstByte: 'Waiting (TTFB)',
  download: 'Download',
};

/** What each phase measures, surfaced as the tooltip on a phase segment. */
export const HTTP_PHASE_HINTS: Readonly<Record<HttpPhaseName, string>> = {
  wait: 'Client-side queueing before the transport started connecting — a saturated agent shows up here.',
  dns: 'Resolving the hostname. Absent on a reused connection or an IP literal.',
  tcp: 'TCP handshake. Absent on a reused connection.',
  tls: 'TLS handshake. Absent on plain HTTP and on a reused connection.',
  connect: 'Establishing the connection (DNS + TCP + TLS), for a client that cannot break it down.',
  request: 'Sending the request, until its last byte left the process.',
  firstByte: 'Waiting for the first response byte — upstream think time plus return latency.',
  download: 'Streaming the response body, first byte to last.',
};

/** Total time the phases account for. The call's own `duration` may exceed it — see {@link HttpPhases}. */
export function sumHttpPhases(phases: HttpPhases | undefined): number {
  if (!phases) return 0;
  let total = 0;
  for (const name of HTTP_PHASE_SEQUENCE) {
    const value = phases[name];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) total += value;
  }
  return Math.round(total * 1000) / 1000;
}

/**
 * A phase duration as it is displayed: whole milliseconds once it is worth rounding, two decimals
 * below that — a 0.42ms handshake must not read as `0ms`.
 */
export function formatPhaseDuration(value: number): string {
  return `${value >= 10 ? Math.round(value) : Math.round(value * 100) / 100}ms`;
}

/** Whether a breakdown carries at least one usable, positive phase. */
export function hasHttpPhases(phases: HttpPhases | undefined): phases is HttpPhases {
  return sumHttpPhases(phases) > 0;
}
