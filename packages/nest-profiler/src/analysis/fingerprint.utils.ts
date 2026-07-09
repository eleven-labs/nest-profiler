/**
 * Deterministic, parameter-free fingerprints used by the performance-rule engine
 * to group repeated calls (the N+1 signal). Each collector owns how it
 * builds a fingerprint — these helpers cover the SQL and HTTP domains; the Mongoose
 * collector builds its own from `collection + operation + filter shape`.
 */

const UUID_SEGMENT = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;
const NUMERIC_SEGMENT = /\/\d+(?=\/|$)/g;

/**
 * Normalizes a SQL statement into a fingerprint stable across parameter values:
 * string/numeric literals and placeholders (`$1`, `:name`, `?`) collapse to `?`,
 * `IN (?, ?, ?)` lists collapse to a single `?`, and whitespace is squashed. Two
 * executions of the same query with different bind values share a fingerprint, so
 * the engine can count them as an N+1 pattern.
 */
export function normalizeSqlFingerprint(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, '?') // single-quoted string literals ('' escape aware)
    .replace(/\$\d+/g, '?') // positional params ($1, $2 — Postgres)
    .replace(/:[a-zA-Z_]\w*/g, '?') // named params (:id)
    .replace(/\b\d+(?:\.\d+)?\b/g, '?') // numeric literals
    .replace(/\?(?:\s*,\s*\?)+/g, '?') // collapse `?, ?, ?` IN-lists
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes an outgoing HTTP request into a `METHOD host/path` fingerprint stable
 * across ids: the query string is dropped, and UUID / numeric path segments become
 * `/:id`. Absolute URLs keep their host so calls to different hosts never collide;
 * relative URLs fall back to their path. Two calls to the same logical endpoint
 * with different ids share a fingerprint.
 */
export function normalizeHttpFingerprint(method: string, url: string): string {
  let path: string;
  try {
    const parsed = new URL(url);
    path = `${parsed.host}${parsed.pathname}`;
  } catch {
    // Relative URL — drop the query string / fragment. Done with indexOf rather than a
    // regex so it stays strictly linear on adversarial input (avoids a ReDoS surface).
    const query = url.indexOf('?');
    const fragment = url.indexOf('#');
    const end = Math.min(
      query === -1 ? url.length : query,
      fragment === -1 ? url.length : fragment,
    );
    path = url.slice(0, end);
  }
  const normalized = path.replace(UUID_SEGMENT, '/:id').replace(NUMERIC_SEGMENT, '/:id');
  return `${method.toUpperCase()} ${normalized}`;
}
