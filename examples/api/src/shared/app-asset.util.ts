import { existsSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Absolute path of a non-TS asset shipped next to the sources (an EJS panel template).
 *
 * Resolved from the working directory rather than from the module: this app is ESM, so there is
 * no `__dirname` at runtime, and `import.meta.dirname` does not survive the CommonJS emit the e2e
 * suite compiles with. `dist` first — that is what a built app runs from.
 */
export function resolveAppAsset(relativePath: string): string | undefined {
  return ['dist', 'src']
    .map((root) => path.join(process.cwd(), root, relativePath))
    .find((candidate) => existsSync(candidate));
}

/** Same, for an asset the caller cannot render without — a missing one means a broken build. */
export function requireAppAsset(relativePath: string): string {
  const resolved = resolveAppAsset(relativePath);
  if (resolved === undefined) throw new Error(`Missing application asset: ${relativePath}`);
  return resolved;
}
