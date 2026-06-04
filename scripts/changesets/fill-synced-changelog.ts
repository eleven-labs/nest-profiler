#!/usr/bin/env tsx
/**
 * Fills the empty changelog entry that Changesets leaves behind when a package
 * is bumped only to stay in sync with the rest of a `fixed` group.
 *
 * Packages that have no changeset of their own (and no out-of-range dependency
 * update) still get a new `## x.y.z` header from `changeset version`, but with
 * no body — neither `getReleaseLine` nor `getDependencyReleaseLine` is invoked
 * for them. This script detects that empty top section and inserts a short note
 * explaining the lockstep bump.
 *
 * Runs after `changeset version` (see the `version-packages` script). It is
 * idempotent: a section that already has content is left untouched.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type BumpType = 'major' | 'minor' | 'patch';

const PACKAGES_DIR = join(process.cwd(), 'packages');
const CHANGESET_CONFIG = join(process.cwd(), '.changeset', 'config.json');
const VERSION_HEADER = /^## (.+)$/;

function readFixedGroupAnchor(): string | null {
  if (!existsSync(CHANGESET_CONFIG)) {
    return null;
  }

  const config = JSON.parse(readFileSync(CHANGESET_CONFIG, 'utf-8')) as {
    fixed?: string[][];
  };

  return config.fixed?.[0]?.[0] ?? null;
}

function parseVersion(version: string): [number, number, number] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function resolveBumpType(current: string, previous: string | null): BumpType {
  const next = parseVersion(current);
  const prev = previous ? parseVersion(previous) : null;

  if (!next || !prev) {
    return 'minor';
  }

  if (next[0] !== prev[0]) {
    return 'major';
  }

  if (next[1] !== prev[1]) {
    return 'minor';
  }

  return 'patch';
}

const BUMP_HEADING: Record<BumpType, string> = {
  major: '### Major Changes',
  minor: '### Minor Changes',
  patch: '### Patch Changes',
};

function buildNote(anchor: string | null): string {
  const reference = anchor ? `\`${anchor}\`` : 'the core package';

  return `Version bump only — released in lockstep with ${reference} to keep the suite on a single version (Changesets \`fixed\` group). No functional changes to this package.`;
}

/**
 * Returns the updated changelog, or `null` when the top section already has a body.
 */
function fillTopSection(changelog: string, anchor: string | null): string | null {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const headerIndices = lines
    .map((line, index) => (VERSION_HEADER.test(line) ? index : -1))
    .filter((index) => index !== -1);

  if (headerIndices.length === 0) {
    return null;
  }

  const topIndex = headerIndices[0];
  const nextIndex = headerIndices[1] ?? lines.length;
  const body = lines
    .slice(topIndex + 1, nextIndex)
    .join('\n')
    .trim();

  if (body !== '') {
    return null;
  }

  const currentVersion = lines[topIndex].match(VERSION_HEADER)?.[1] ?? '';
  const previousVersion = lines[nextIndex]?.match(VERSION_HEADER)?.[1] ?? null;
  const heading = BUMP_HEADING[resolveBumpType(currentVersion, previousVersion)];

  const insertion = ['', heading, '', `- ${buildNote(anchor)}`, ''];
  lines.splice(topIndex + 1, nextIndex - (topIndex + 1), ...insertion);

  return lines.join('\n');
}

function main(): void {
  if (!existsSync(PACKAGES_DIR)) {
    return;
  }

  const anchor = readFixedGroupAnchor();
  const filled: string[] = [];

  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const changelogPath = join(PACKAGES_DIR, entry.name, 'CHANGELOG.md');
    if (!existsSync(changelogPath)) {
      continue;
    }

    const updated = fillTopSection(readFileSync(changelogPath, 'utf-8'), anchor);
    if (updated !== null) {
      writeFileSync(changelogPath, updated);
      filled.push(entry.name);
    }
  }

  if (filled.length === 0) {
    console.log('Changelog sync OK: no empty lockstep sections to fill.');
    return;
  }

  console.log(`Changelog sync: filled lockstep release notes for ${filled.length} package(s):`);
  for (const name of filled) {
    console.log(`- ${name}`);
  }
}

main();
