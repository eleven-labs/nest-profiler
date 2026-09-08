import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import { DEFAULT_MASK_HEADERS } from './redact-headers.util';
import { buildMaskedQueryParams, DEFAULT_MASK_QUERY_PARAMS } from './redact-query.util';
import { REDACTED } from './redact.utils';
import type { RedactOptions } from './redact.utils';

/**
 * The effective masking configuration for one profiler instance, resolved once from
 * {@link ProfilerModuleOptions.redaction}.
 *
 * Resolved in one shared place rather than per capture site: the middleware (request headers,
 * cookies, query string, body, session) and the interceptor (response headers, response body)
 * both mask, and a second copy of this merge is how the two drift apart.
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
 * Resolves the `redaction` block into the sets every capture site masks against. Each list is
 * **additive** over the built-ins: naming an entry extends them rather than replacing them, so
 * adding one header can never silently stop `authorization` from being masked. `useDefaults:
 * false` is the deliberate, total opt-out — it drops every built-in list at once.
 */
export function resolveRedactionConfig(options: ProfilerModuleOptions): ResolvedRedactionConfig {
  const redaction = options.redaction;
  const useDefaults = redaction?.useDefaults !== false;
  const replacement = redaction?.replacement ?? REDACTED;

  return {
    maskHeaders: new Set(
      [...(useDefaults ? DEFAULT_MASK_HEADERS : []), ...(redaction?.headers ?? [])].map((h) =>
        h.toLowerCase(),
      ),
    ),
    maskQueryParams: buildMaskedQueryParams([
      ...(useDefaults ? DEFAULT_MASK_QUERY_PARAMS : []),
      ...(redaction?.queryParams ?? []),
    ]),
    maskCookies: new Set(redaction?.cookies ?? []),
    replacement,
    redactOptions: {
      maskKeys: redaction?.keys ?? [],
      patterns: redaction?.patterns ?? [],
      replacement,
      // `useDefaults: false` takes masking over entirely: the built-in sensitive-key pattern goes
      // with the built-in header/query lists, leaving only the names spelled out in `keys`.
      ...(useDefaults ? {} : { keyPattern: /(?!)/ }),
    },
  };
}
