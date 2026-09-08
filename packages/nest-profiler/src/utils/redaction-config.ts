import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import { DEFAULT_MASK_HEADERS } from './redact-headers.util';
import { buildMaskedQueryParams, DEFAULT_MASK_QUERY_PARAMS } from './redact-query.util';
import { REDACTED } from './redact.utils';
import type { RedactOptions } from './redact.utils';

/**
 * The effective masking configuration for one profiler instance, resolved once from
 * {@link ProfilerModuleOptions.redaction} and the deprecated flat options it replaces.
 *
 * Resolved in one shared place rather than per capture site: the middleware (request headers,
 * cookies, query string, body, session) and the interceptor (response headers, response body)
 * both mask, and a second copy of this merge is how the two drift apart — exactly the drift
 * this branch fixed in `nest-profiler-rabbitmq`.
 */
export interface ResolvedRedactionConfig {
  /** Header names (lowercase) masked on capture, request **and** response. */
  maskHeaders: ReadonlySet<string>;
  /** Query-parameter names masked in the stored URL and the parsed query. */
  maskQueryParams: ReadonlySet<string>;
  /** Cookie names whose value is replaced. */
  maskCookies: ReadonlySet<string>;
  /** The sentinel written in place of a masked value. */
  replacement: string;
  /** Options handed to {@link redact} for bodies, session data and free-form payloads. */
  redactOptions: RedactOptions;
}

/**
 * Merges the unified `redaction` block with the deprecated flat options (`maskHeaders`,
 * `maskCookies`, `maskQueryParams`, `useDefaultMask*`). Every list is **additive**: naming an
 * entry through either surface extends the built-ins rather than replacing them.
 */
export function resolveRedactionConfig(options: ProfilerModuleOptions): ResolvedRedactionConfig {
  const redaction = options.redaction;
  // Turning defaults off through *either* the unified block or a deprecated flat flag disables
  // them — the safety net only ever narrows on an explicit, deliberate opt-out, never widens
  // back on because the other (soon-removed) option still says `true`.
  const useDefaultHeaders =
    redaction?.useDefaults !== false && options.useDefaultMaskHeaders !== false;
  const useDefaultQueryParams =
    redaction?.useDefaults !== false && options.useDefaultMaskQueryParams !== false;
  const replacement = redaction?.replacement ?? REDACTED;

  return {
    maskHeaders: new Set(
      [
        ...(useDefaultHeaders ? DEFAULT_MASK_HEADERS : []),
        ...(options.maskHeaders ?? []),
        ...(redaction?.headers ?? []),
      ].map((h) => h.toLowerCase()),
    ),
    maskQueryParams: buildMaskedQueryParams([
      ...(useDefaultQueryParams ? DEFAULT_MASK_QUERY_PARAMS : []),
      ...(options.maskQueryParams ?? []),
      ...(redaction?.queryParams ?? []),
    ]),
    maskCookies: new Set([...(options.maskCookies ?? []), ...(redaction?.cookies ?? [])]),
    replacement,
    redactOptions: {
      maskKeys: redaction?.keys ?? [],
      patterns: redaction?.patterns ?? [],
      replacement,
      // `useDefaults: false` takes masking over entirely: the built-in sensitive-key pattern goes
      // with the built-in header/query lists, leaving only the names spelled out in `keys`.
      ...(redaction?.useDefaults === false ? { keyPattern: /(?!)/ } : {}),
    },
  };
}
