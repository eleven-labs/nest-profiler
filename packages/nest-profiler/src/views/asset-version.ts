import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getProfilerVersion } from '../version';

/** Per-path digest cache: each asset is read and hashed once, then reused for the process lifetime. */
const queryCache = new Map<string, string>();

/**
 * The `?v=<digest>` cache-buster for a single asset, derived from that file's own bytes.
 *
 * Per-file fingerprinting (rather than a single package-version query for every asset) means an
 * asset URL changes only when that asset changes — so a long-lived (immutable) browser/proxy
 * cache is invalidated for the files that actually differ, never the whole set on a version bump.
 * Assets are content-addressed and served immutable, so the digest is computed once and cached.
 *
 * Falls back to the package version when the file cannot be read — running from source or in unit
 * tests (before the asset build has run), or for a registered bundle whose path is unresolved.
 */
export function assetVersionQuery(absPath: string): string {
  let query = queryCache.get(absPath);
  if (query === undefined) {
    try {
      const digest = createHash('sha256').update(readFileSync(absPath)).digest('hex').slice(0, 12);
      query = `?v=${digest}`;
    } catch {
      query = `?v=${getProfilerVersion()}`;
    }
    queryCache.set(absPath, query);
  }
  return query;
}
