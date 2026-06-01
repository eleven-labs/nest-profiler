#!/usr/bin/env tsx
/**
 * Rewrite repo-relative screenshot paths in every publishable package README to
 * absolute URLs, so images render on registries (npmjs) that do not resolve
 * relative paths.
 *
 * This runs only at publish time (wired into the `release` script) on the CI
 * runner. The committed sources stay relative and free of any hardcoded github
 * link; the `release` script reverts the working tree right after publishing.
 *
 * The base is pinned to the release commit (`GITHUB_SHA`) so each published
 * version points at the screenshots exactly as they were at that commit — the
 * URLs never break, even if the files move later. Falls back to `main` locally.
 * Swap `REPO`/the base host for a CDN or docs domain when one is available.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = 'eleven-labs/nest-profiler';
const REF = process.env.GITHUB_SHA ?? 'main';
const BASE = `https://raw.githubusercontent.com/${REPO}/${REF}/docs/public`;

// Package READMEs live at `packages/<name>/README.md` and reference screenshots
// as `../../docs/public/screenshots/...`. Map that relative prefix to BASE.
const RELATIVE_PREFIX = '](../../docs/public/';
const ABSOLUTE_PREFIX = `](${BASE}/`;

const packagesDir = join(process.cwd(), 'packages');
const rewritten: string[] = [];

for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;

  const readmePath = join(packagesDir, entry.name, 'README.md');
  let content: string;
  try {
    content = readFileSync(readmePath, 'utf8');
  } catch {
    continue; // package without a README (e.g. configs)
  }

  if (!content.includes(RELATIVE_PREFIX)) continue;

  writeFileSync(readmePath, content.split(RELATIVE_PREFIX).join(ABSOLUTE_PREFIX));
  rewritten.push(`packages/${entry.name}/README.md`);
}

console.log(`Absolutized README image paths against ${BASE}`);
for (const file of rewritten) console.log(`  ✓ ${file}`);
if (rewritten.length === 0) console.log('  (no relative screenshot paths found)');
