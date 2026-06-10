import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Runs once per jest invocation: starts from an empty `.profiler` directory. The profiles
 * written by the suite are deliberately kept after the run, so they can be browsed at
 * `/_profiler` by starting the example server (`pnpm example:dev`).
 */
export default function globalSetup(): void {
  const storageDir = path.resolve(__dirname, '..', '.profiler');
  fs.rmSync(storageDir, { recursive: true, force: true });
  fs.mkdirSync(storageDir, { recursive: true });
}
