#!/usr/bin/env tsx
/**
 * Verify that every published package can be `require()`d from a CommonJS application.
 *
 *   pnpm check:cjs-require
 *
 * The packages ship CommonJS, so a consumer's `require()` must work — but a value import of an
 * ESM-only dependency (`ai`, say) compiles to a `require()` Node refuses:
 *
 *   Error [ERR_REQUIRE_ESM]: require() of ES Module … not supported
 *
 * Nothing else catches it. The compiler is happy, the unit tests force CommonJS on both sides so
 * the dependency is transformed too, and the e2e suite runs the example as ESM. It surfaces in a
 * deployed CommonJS app — which is exactly where it must not.
 *
 * Node has loaded ESM from `require()` since 22.12, which hides the problem on a recent runtime
 * and not on the one a user deploys to. `--no-experimental-require-module` turns that back off,
 * so this runs the strict, older behaviour whatever Node built it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGES_DIR = join(process.cwd(), 'packages');

interface Manifest {
  name?: string;
  private?: boolean;
  main?: string;
  type?: string;
}

interface Entry {
  name: string;
  /** The built entry point a consumer's `require()` lands on. */
  entry: string;
}

/**
 * Every workspace package that is actually published, with its built entry point. It is required
 * by path rather than by name: only the packages a workspace root depends on resolve by name, and
 * what matters here is the file that ships.
 */
function publishedEntries(): Entry[] {
  const entries: Entry[] = [];
  for (const dir of readdirSync(PACKAGES_DIR)) {
    let manifest: Manifest;
    try {
      manifest = JSON.parse(
        readFileSync(join(PACKAGES_DIR, dir, 'package.json'), 'utf8'),
      ) as Manifest;
    } catch {
      continue; // not a package (the shared configs live in subdirectories of their own)
    }
    if (manifest.private === true || manifest.name === undefined) continue;
    // A package that ships ESM on purpose (nest-profiler-mikro-orm, because MikroORM is
    // ESM-only) is consumed with `import`, and requiring it is expected to fail.
    if (manifest.type === 'module') continue;
    entries.push({
      name: manifest.name,
      entry: join(PACKAGES_DIR, dir, manifest.main ?? './dist/index.js'),
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** The line that says what went wrong, past Node's own stack frames. */
function reason(stderr: string): string {
  const lines = stderr.split('\n').map((line) => line.trim());
  return lines.find((line) => line.startsWith('Error')) ?? lines.find((line) => line !== '') ?? '';
}

const entries = publishedEntries();
const failures: string[] = [];

for (const { name, entry } of entries) {
  if (!existsSync(entry)) {
    failures.push(`${name}: ${entry} is missing — run \`pnpm build\` first`);
    continue;
  }
  try {
    execFileSync(
      process.execPath,
      ['--no-experimental-require-module', '-e', `require(${JSON.stringify(entry)})`],
      { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' },
    );
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? String(error);
    failures.push(`${name}: ${reason(stderr)}`);
  }
}

if (failures.length > 0) {
  console.error('These packages cannot be required from CommonJS:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('\nReach an ESM-only dependency through a dynamic import() instead.');
  process.exit(1);
}

console.log(`Every published package requires cleanly from CommonJS (${entries.length}).`);
