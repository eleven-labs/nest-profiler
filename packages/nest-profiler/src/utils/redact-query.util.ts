import { REDACTED } from './redact.utils';

/**
 * Query-parameter names whose value is masked at capture by default.
 *
 * A query string is the one place a credential travels in plain sight: password-reset and
 * invite tokens, OAuth authorization codes, signed-URL signatures. The captured URL is stored
 * on every profile, rendered in the dashboard, exported by `/_profiler/:token/data` and copied
 * into the "Copy as cURL" command, so a value that reaches it is readable for as long as the
 * profile lives.
 *
 * Deliberately kept in step with {@link DEFAULT_MASK_HEADERS} and
 * {@link DEFAULT_SECRET_KEY_RE}: the same secret is as sensitive in a URL as it is in a header
 * or in a body, and two lists that drift apart mean one of the paths quietly stops protecting
 * something.
 *
 * Compared case-insensitively, ignoring `-` and `_`, so `access_token`, `accessToken` and
 * `access-token` are one entry.
 */
export const DEFAULT_MASK_QUERY_PARAMS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'api_key',
  'api_token',
  'auth',
  'authorization',
  'code',
  'credential',
  'credentials',
  'private_key',
  'access_key',
  'secret_key',
  'client_secret',
  'session_id',
  'sig',
  'signature',
  'state',
];

/** Case- and separator-insensitive form used to compare parameter names. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

/** Builds the comparison set a `maskQueryParams` option resolves to. */
export function buildMaskedQueryParams(names: readonly string[]): ReadonlySet<string> {
  return new Set(names.map(normalizeKey));
}

/** Whether a parameter name is one whose value must be masked. */
function isMasked(key: string, masked: ReadonlySet<string>): boolean {
  return masked.has(normalizeKey(key));
}

/**
 * Masks the values of sensitive parameters in a request URL, keeping the parameter names.
 *
 * Knowing that a request carried a `token` is useful when reading a trace; knowing *which*
 * token is not — hence `?token=[REDACTED]` rather than a vanished pair.
 *
 * Only names are inspected, never values: a pattern hunting for token-shaped strings anywhere
 * in a URL mangles ordinary ids and path segments, and a redactor that mangles real data is one
 * somebody switches off.
 *
 * Returns the URL untouched when it carries nothing to mask, so a benign URL is stored exactly
 * as it arrived rather than in `URLSearchParams`' normalised spelling.
 */
export function redactQueryString(url: string, masked: ReadonlySet<string>): string {
  const separator = url.indexOf('?');
  if (separator === -1 || masked.size === 0) return url;

  const path = url.slice(0, separator);
  const rest = url.slice(separator + 1);
  // A fragment never reaches a server, but `req.url` is not the only caller this may ever
  // have, and splitting it off keeps it out of the query parse.
  const hashAt = rest.indexOf('#');
  const fragment = hashAt === -1 ? '' : rest.slice(hashAt);

  // Parsed rather than pattern-replaced: the parser is what knows that a value may contain an
  // escaped `&`, and that a repeated key carries several values.
  const params = new URLSearchParams(hashAt === -1 ? rest : rest.slice(0, hashAt));
  let redactedAny = false;
  // The keys are materialised before the loop: `set` mutates the object the iterator walks.
  for (const key of [...new Set(params.keys())]) {
    if (!isMasked(key, masked)) continue;
    params.set(key, REDACTED);
    redactedAny = true;
  }

  return redactedAny ? `${path}?${params.toString()}${fragment}` : url;
}

/**
 * Masks the values of sensitive parameters in an already-parsed query record — the platform's
 * own `req.query`, whose values may be repeated (`string[]`) or nested by a rich query parser.
 *
 * Returns the record untouched when it carries nothing to mask.
 */
export function redactQueryRecord<T extends Record<string, unknown>>(
  query: T,
  masked: ReadonlySet<string>,
): T {
  if (masked.size === 0) return query;

  const keys = Object.keys(query);
  if (!keys.some((key) => isMasked(key, masked))) return query;

  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const value = query[key];
    result[key] = isMasked(key, masked)
      ? Array.isArray(value)
        ? value.map(() => REDACTED)
        : REDACTED
      : value;
  }
  return result as T;
}
