/**
 * The installed profiler package version, used as an asset cache-buster (`?v=<version>`).
 * Because the asset URLs (`profiler.css`, `profiler.js`…) are not content-fingerprinted, the
 * version query keeps browsers/proxies from serving a stale CSS/JS bundle after an upgrade.
 *
 * Resolved from this package's own `package.json`. `version.ts` sits at the source root, so
 * `../package.json` resolves correctly from both `src/version.ts` and `dist/version.js`.
 */
export function getProfilerVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../package.json') as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** The `?v=<version>` query string appended to profiler asset URLs. */
export const ASSET_VERSION_QUERY = `?v=${getProfilerVersion()}`;
