/**
 * Appends a link-query string (produced by `security.linkQuery`) to an href, joining with
 * `?` or `&` depending on whether the href already carries a query. A leading `?`/`&` on
 * `query` is tolerated. An empty query returns the href unchanged. Used to propagate a
 * query-param credential across the profiler UI's `<a>` navigation.
 */
export function appendLinkQuery(href: string, query: string): string {
  const normalized = query.replace(/^[?&]+/, '');
  if (!normalized) return href;
  const sep = href.includes('?') ? '&' : '?';
  return `${href}${sep}${normalized}`;
}

/** Splits a link-query string into `{ name, value }` pairs (for GET-form hidden inputs). */
export function linkQueryPairs(query: string): { name: string; value: string }[] {
  const normalized = query.replace(/^[?&]+/, '');
  if (!normalized) return [];
  return [...new URLSearchParams(normalized)].map(([name, value]) => ({ name, value }));
}
