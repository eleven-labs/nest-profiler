#!/usr/bin/env tsx
/**
 * Point the workspace's NestJS dev dependencies at another supported NestJS major, so CI can run
 * the suites against it (`pnpm nestjs:use 11 && pnpm install --no-frozen-lockfile`).
 *
 * The committed manifests and lockfile track the newest major; this rewrites the devDependency
 * (and example-app dependency) ranges of every `packages/*` and `examples/*` manifest in place.
 * Peer ranges are left untouched: they already accept every supported major. Only CI runs this;
 * locally, checking the manifests and `pnpm-lock.yaml` back out reverts it.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Ranges = Record<string, string>;

/** Dependency ranges per NestJS major, for every NestJS-versioned package the workspace uses. */
const RANGES_BY_MAJOR: Record<string, Ranges> = {
  '11': {
    '@nestjs/common': '^11.2.7',
    '@nestjs/core': '^11.2.7',
    '@nestjs/testing': '^11.2.7',
    '@nestjs/platform-express': '^11.2.7',
    '@nestjs/platform-fastify': '^11.2.7',
    '@nestjs/graphql': '^13.4.5',
    '@nestjs/apollo': '^13.4.5',
    '@nestjs/mercurius': '^13.4.5',
    '@nestjs/config': '^4.0.2',
    '@nestjs/cache-manager': '^3.0.1',
    '@nestjs/event-emitter': '^3.0.1',
    '@nestjs/mongoose': '^11.0.1',
    '@nestjs/axios': '^4.0.0',
    '@nestjs/swagger': '^11.4.7',
  },
};

const BUCKETS = ['dependencies', 'devDependencies'] as const;

function manifestPaths(): string[] {
  return ['packages', 'examples'].flatMap((dir) =>
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name, 'package.json'))
      .filter((path) => existsSync(path)),
  );
}

/** Rewrites the matching ranges of one manifest; returns whether anything changed. */
function rewriteManifest(path: string, ranges: Ranges): boolean {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Ranges | undefined>;
  let changed = false;
  for (const bucket of BUCKETS) {
    const deps = manifest[bucket];
    if (!deps) continue;
    for (const [name, range] of Object.entries(ranges)) {
      if (deps[name] === undefined || deps[name] === range) continue;
      deps[name] = range;
      changed = true;
    }
  }
  if (changed) writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return changed;
}

const major = process.argv[2] ?? '';
const ranges = RANGES_BY_MAJOR[major];
if (!ranges) {
  console.error(`Usage: pnpm nestjs:use <${Object.keys(RANGES_BY_MAJOR).join('|')}>`);
  process.exit(1);
}

const rewritten = manifestPaths().filter((path) => rewriteManifest(path, ranges));
console.log(`NestJS ${major} ranges applied to ${rewritten.length} manifest(s):`);
for (const path of rewritten) console.log(`  ${path}`);
