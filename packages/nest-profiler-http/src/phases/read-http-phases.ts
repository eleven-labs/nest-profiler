import type { ClientRequest } from 'node:http';
import type { HttpPhases, HttpPhaseName } from '../http-phases.interface';
import { hasHttpPhases } from '../http-phases.interface';
import { isInstrumentedClientRequest, phasesOfClientRequest } from './client-request-timer';

/** Properties that lead from an object an instrumentation holds towards the underlying request. */
const UNWRAP_KEYS = ['request', 'req'] as const;

/**
 * `follow-redirects`' pointer to the hop that actually answered. Followed *before* the wrapper's
 * own timings, because a wrapper that carries both is describing the whole redirect chain while
 * the caller was handed the last response.
 */
const FINAL_HOP_KEY = '_currentRequest';

/** Phase names as they appear on an `@szmarczak/http-timer` (and therefore `got`) breakdown. */
const TIMER_PHASES: readonly HttpPhaseName[] = [
  'wait',
  'dns',
  'tcp',
  'tls',
  'request',
  'firstByte',
  'download',
];

/**
 * Find the {@link HttpPhases} behind whatever object an instrumentation holds when it records a
 * call — an `AxiosResponse`, an axios error, a `ClientRequest`, an `IncomingMessage`, a
 * `follow-redirects` wrapper, or a `got` response.
 *
 * Two sources are recognised, in this order:
 *
 * 1. a request timed by {@link instrumentClientRequest} (what the `NodeHttpPhases` provider
 *    installs);
 * 2. a `timings.phases` breakdown the client produced itself — the shape
 *    `@szmarczak/http-timer` writes, so `got` (which embeds it) and anyone using that library
 *    directly are read natively, with no provider installed and no dependency on it here.
 *
 * Returns `undefined` when nothing timed the call, which is the normal state when no phases
 * provider is registered — every caller treats it as "no breakdown available", never an error.
 *
 * On a redirected call the phases describe the last hop only: the earlier hops are separate
 * requests, and their timings would not add up to a single response's story.
 */
export function readHttpPhases(source: unknown): HttpPhases | undefined {
  return unwrap(source, 0);
}

function unwrap(source: unknown, depth: number): HttpPhases | undefined {
  if (source == null || typeof source !== 'object' || depth > 4) return undefined;

  const finalHop = read(source, FINAL_HOP_KEY);
  if (finalHop != null && finalHop !== source) {
    const found = unwrap(finalHop, depth + 1);
    if (found) return found;
  }

  const own = ownPhases(source);
  if (own) return own;

  for (const key of UNWRAP_KEYS) {
    const next = read(source, key);
    if (next != null && next !== source) {
      const found = unwrap(next, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function ownPhases(source: object): HttpPhases | undefined {
  if (isInstrumentedClientRequest(source as ClientRequest)) {
    return phasesOfClientRequest(source as ClientRequest);
  }
  return fromTimerTimings(read(source, 'timings'));
}

/** Maps an `@szmarczak/http-timer` breakdown onto {@link HttpPhases}, keeping only real numbers. */
function fromTimerTimings(timings: unknown): HttpPhases | undefined {
  if (timings == null || typeof timings !== 'object') return undefined;
  const source = read(timings, 'phases');
  if (source == null || typeof source !== 'object') return undefined;

  const phases: HttpPhases = {};
  for (const name of TIMER_PHASES) {
    const value = read(source, name);
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) phases[name] = value;
  }
  return hasHttpPhases(phases) ? phases : undefined;
}

/**
 * Property access, guarded. These objects come from foreign libraries and from DI containers, and
 * some expose throwing getters (nestjs-cls proxy providers are the known case); a profiler must
 * not turn that into a failed request.
 */
function read(source: object, key: string): unknown {
  try {
    return (source as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}
