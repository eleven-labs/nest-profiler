import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { Profile } from '../interfaces/profile.interface';
import { completeProfilePerformance } from './profile-metrics.util';
import { extractHeaders } from './redact-headers.util';
import { redact } from './redact.utils';
import { resolveRedactionConfig } from './redaction-config';
import type { ResolvedRedactionConfig } from './redaction-config';
import { DEFAULT_MAX_BODY_SIZE, normalizeBody } from './safe-data.utils';
import type { SafeDataOptions } from './safe-data.utils';

/**
 * How HTTP request and response payloads are turned into profile data, resolved once from the
 * module options.
 *
 * The middleware (request body, request headers) and the interceptor (response body, response
 * headers) captured through two identical private copies of the same logic. One resolved
 * configuration and the free functions below are what keeps them from masking or bounding
 * differently — the same reason {@link resolveRedactionConfig} exists.
 */
export interface HttpCaptureConfig {
  /** Whether request/response bodies are recorded at all (`collectBody`). */
  collectBody: boolean;
  /** Byte cap applied before redaction (`maxBodySize`). */
  maxBodySize: number;
  /** Structural caps applied before redaction (`bodyCaptureLimits`). */
  bodyCaptureLimits: SafeDataOptions | undefined;
  /** The masking configuration applied to headers and bodies alike. */
  redaction: ResolvedRedactionConfig;
}

/** Resolves the capture settings shared by every HTTP capture site. */
export function resolveHttpCaptureConfig(options: ProfilerModuleOptions): HttpCaptureConfig {
  return {
    collectBody: options.collectBody ?? false,
    maxBodySize: options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE,
    bodyCaptureLimits: options.bodyCaptureLimits,
    redaction: resolveRedactionConfig(options),
  };
}

/**
 * JSON-safe, size-bounded, redacted copy of a captured body (see `maxBodySize` /
 * `bodyCaptureLimits` / `redaction`). Bounded first, then redacted: the caps have already dropped
 * everything that will not be stored, so masking only walks what reaches the profile.
 */
export function captureBody(body: unknown, config: HttpCaptureConfig): unknown {
  const safe = normalizeBody(body, config.maxBodySize, config.bodyCaptureLimits);
  return redact(safe, config.redaction.redactOptions);
}

/**
 * Flattens a request or response header bag onto the profile, masking every header in
 * `redaction.headers`. A response carries credentials too — `set-cookie` is a session for as long
 * as the profile lives — so it is masked on the same list as the request.
 */
export function captureHeaders(
  headers: unknown,
  config: HttpCaptureConfig,
): Record<string, string | string[]> {
  return extractHeaders(headers, config.redaction.maskHeaders, {
    replacement: config.redaction.replacement,
    multiValue: true,
  });
}

/** What the caller knows about a completed response, handed to {@link finalizeHttpProfile}. */
export interface HttpResponseOutcome {
  /**
   * The status the client is served. Passed in rather than read off the transport because on the
   * failure paths the transport still reads `200`: exception filters run after the interceptor's
   * observable chain, so the status has to be derived from the error instead.
   */
  statusCode: number;
  /** Raw outgoing header bag, or `undefined` when the transport headers are not observable. */
  headers?: unknown;
  /** The payload the client receives, or `undefined` when it could not be recovered. */
  body?: unknown;
  /**
   * Record `body` even when `collectBody` is off. Set for a non-HTTP result (a GraphQL resolver's
   * return value), which is the whole of what that profile has to show.
   */
  alwaysCaptureBody?: boolean;
}

/**
 * Closes a profile: its duration and resource usage, then `profile.response`.
 *
 * The single place `profile.response` is built. It used to be built in three — the interceptor's
 * normal path, the interceptor's own `finish` listener and the middleware's — which is why the two
 * listeners had to guard each other with `if (profile.response) return` and why the error paths
 * built a response only to immediately patch its status back. Persistence is deliberately *not*
 * done here: what happens next differs per call site (an HTML response waits for the collectors so
 * the toolbar can be injected, everything else is emitted first and persisted after).
 */
export function finalizeHttpProfile(
  profile: Profile,
  outcome: HttpResponseOutcome,
  config: HttpCaptureConfig,
): void {
  completeProfilePerformance(profile);
  const recordBody = config.collectBody || outcome.alwaysCaptureBody === true;
  profile.response = {
    statusCode: outcome.statusCode,
    headers: outcome.headers === undefined ? {} : captureHeaders(outcome.headers, config),
    body: recordBody ? captureBody(outcome.body, config) : undefined,
  };
}
