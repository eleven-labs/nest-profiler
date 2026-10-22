#!/usr/bin/env tsx
/**
 * Verify that every published entry point can be `import`ed from an ESM application, without
 * Node's require(esm) and without loading any CommonJS build of the profiler alongside.
 *
 *   pnpm check:esm-import
 *
 * The CommonJS packages also ship an ESM build (`dist/esm`) that their exports map serves to
 * `import`. An ESM application on NestJS 12, whose packages are ESM, then never `require()`s an
 * ES module because of the profiler: the call that fails wherever a runtime turns require(esm)
 * off. Two things can quietly undo that, and only a real import shows them:
 *
 * - a `require()` left in the ESM build reaching an ESM-only dependency — caught by running with
 *   `--no-experimental-require-module`, the strict behaviour whatever Node runs this;
 * - an ESM file resolving a CommonJS build of the profiler (an exports map missing its `import`
 *   condition, say). Both copies would then load, each with its own classes, and Nest would inject
 *   one `TracerService` while the core provides the other — so any `dist/*.js` outside `dist/esm`
 *   showing up in the CommonJS module cache fails the check.
 *
 * A CommonJS dependency that itself `require()`s an ESM-only package (`nest-commander` or
 * `@golevelup/nestjs-rabbitmq` on NestJS 12) fails the same way in the application that uses it,
 * profiler or not: that is reported, not failed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKAGES_DIR = join(process.cwd(), 'packages');

type ExportTarget = string | { import?: string | { default?: string }; default?: string };

interface Manifest {
  name?: string;
  private?: boolean;
  type?: string;
  exports?: Record<string, ExportTarget>;
}

interface Entry {
  /** The specifier a consumer imports, e.g. `@eleven-labs/nest-profiler/sqlite`. */
  name: string;
  /** The built file the `import` condition lands on. */
  entry: string;
}

/** The file an ESM consumer resolves for one exports entry, if it is meant to be imported. */
function importTarget(target: ExportTarget, manifest: Manifest): string | undefined {
  if (typeof target === 'string') return manifest.type === 'module' ? target : undefined;
  if (typeof target.import === 'string') return target.import;
  return target.import?.default;
}

/** Every published entry point with an ESM build, by the specifier a consumer imports. */
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
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      const file = importTarget(target, manifest);
      if (!file?.endsWith('.js')) continue;
      entries.push({
        name: subpath === '.' ? manifest.name : `${manifest.name}${subpath.slice(1)}`,
        entry: join(PACKAGES_DIR, dir, file),
      });
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The third-party CommonJS package behind an `ERR_REQUIRE_ESM`, when the failing `require()` is
 * not ours: `… from /…/node_modules/nest-commander/src/x.js not supported` names `nest-commander`.
 */
function requiringDependency(stderr: string): string | undefined {
  const from = /ERR_REQUIRE_ESM\]: require\(\) of ES Module \S+ from (\S+) not supported/.exec(
    stderr,
  )?.[1];
  const match =
    from === undefined ? null : /.*node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(from);
  const name = match?.[1]?.replace('\\', '/');
  return name === undefined || name.startsWith('@eleven-labs/') ? undefined : name;
}

/** The line that says what went wrong, past Node's own stack frames. */
function reason(stderr: string): string {
  const lines = stderr.split('\n').map((line) => line.trim());
  return lines.find((line) => line.startsWith('Error')) ?? lines.find((line) => line !== '') ?? '';
}

// Runs in the child: import the entry, then look for a CommonJS build of the profiler in the cache.
const probe = (entry: string): string => `
  await import(${JSON.stringify(pathToFileURL(entry).href)});
  const { createRequire } = await import('node:module');
  const loaded = Object.keys(createRequire(${JSON.stringify(`${process.cwd()}/`)}).cache);
  const twin = loaded.find((file) => /[\\\\/]packages[\\\\/][^\\\\/]+[\\\\/]dist[\\\\/](?!esm[\\\\/]).*\\.js$/.test(file));
  if (twin) throw new Error('CommonJS build loaded alongside the ESM one: ' + twin);
`;

const entries = publishedEntries();
const failures: string[] = [];
const limited: string[] = [];

for (const { name, entry } of entries) {
  if (!existsSync(entry)) {
    failures.push(`${name}: ${entry} is missing — run \`pnpm build\` first`);
    continue;
  }
  try {
    execFileSync(
      process.execPath,
      ['--no-experimental-require-module', '--input-type=module', '-e', probe(entry)],
      { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' },
    );
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? String(error);
    const dependency = requiringDependency(stderr);
    if (dependency === undefined) failures.push(`${name}: ${reason(stderr)}`);
    else limited.push(`${name}: its CommonJS dependency ${dependency} require()s an ES module`);
  }
}

if (limited.length > 0) {
  console.warn('Limited by a dependency, not by this package (the app using it fails the same):\n');
  for (const line of limited) console.warn(`  - ${line}`);
  console.warn('');
}

if (failures.length > 0) {
  console.error('These entry points cannot be imported from ESM on their own:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

const clean = entries.length - limited.length;
console.log(
  limited.length === 0
    ? `Every published entry point imports cleanly from ESM (${clean}).`
    : `Every other published entry point imports cleanly from ESM (${clean} of ${entries.length}).`,
);
