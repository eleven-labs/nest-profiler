/**
 * The installed profiler package version. Used as the asset cache-buster fallback when a
 * file's content digest cannot be computed (see {@link assetVersionQuery}).
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
