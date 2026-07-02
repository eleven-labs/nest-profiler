// Shared client-side bundler for profiler packages. Authored browser behaviour
// lives in each package's `src/client` as TypeScript; esbuild type-strips and
// bundles it into a single self-contained IIFE served same-origin from `dist`.
// The contract between bundles at runtime is the global `window.NestProfiler`
// API exposed by the core `profiler.js` — never a cross-package import.
import { build } from 'esbuild';

/**
 * Bundle a client entry point into a single browser IIFE.
 *
 * @param {object} options
 * @param {string} options.entry   Absolute path to the client entry `.ts` file.
 * @param {string} options.outfile Absolute path of the bundle to emit.
 */
export async function bundleClient({ entry, outfile }) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2019',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
  });
}
