#!/usr/bin/env tsx
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type ReleaseType = 'major' | 'minor' | 'patch';

type ChangesetRelease = {
  file: string;
  packageName: string;
  releaseType: ReleaseType;
  currentVersion?: string;
};

const CHANGESET_DIR = join(process.cwd(), '.changeset');
const PACKAGES_DIR = join(process.cwd(), 'packages');
const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'y', 'on']);

function isMajorBumpAllowed(): boolean {
  return TRUTHY_VALUES.has((process.env.ALLOW_MAJOR_BUMPS ?? '').trim().toLowerCase());
}

function loadPackageVersions(): Map<string, string> {
  const versions = new Map<string, string>();

  if (!existsSync(PACKAGES_DIR)) {
    return versions;
  }

  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageJsonPath = join(PACKAGES_DIR, entry.name, 'package.json');
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
      name?: string;
      version?: string;
    };

    if (packageJson.name && packageJson.version) {
      versions.set(packageJson.name, packageJson.version);
    }
  }

  return versions;
}

function readChangesetReleases(
  file: string,
  packageVersions: Map<string, string>,
): ChangesetRelease[] {
  const content = readFileSync(join(CHANGESET_DIR, file), 'utf-8').replace(/\r\n/g, '\n');

  if (!content.startsWith('---\n')) {
    return [];
  }

  const frontmatterEnd = content.indexOf('\n---', 4);
  if (frontmatterEnd === -1) {
    return [];
  }

  const frontmatter = content.slice(4, frontmatterEnd);
  const releases: ChangesetRelease[] = [];

  for (const line of frontmatter.split('\n')) {
    const match = line.trim().match(/^['"]?([^'":]+(?:\/[^'":]+)?)['"]?:\s*(major|minor|patch)$/);

    if (!match) {
      continue;
    }

    const [, packageName, releaseType] = match as [string, string, ReleaseType];
    releases.push({
      file,
      packageName,
      releaseType,
      currentVersion: packageVersions.get(packageName),
    });
  }

  return releases;
}

function main(): void {
  if (!existsSync(CHANGESET_DIR)) {
    console.log('Changeset release policy OK: no .changeset directory found.');
    return;
  }

  const packageVersions = loadPackageVersions();
  const changesetFiles = readdirSync(CHANGESET_DIR).filter((file) => file.endsWith('.md'));

  if (changesetFiles.length === 0) {
    console.log('Changeset release policy OK: no pending changesets.');
    return;
  }

  const majorBumps = changesetFiles
    .flatMap((file) => readChangesetReleases(file, packageVersions))
    .filter((release) => release.releaseType === 'major');

  if (majorBumps.length === 0) {
    console.log('Changeset release policy OK: no major version bump found.');
    return;
  }

  if (isMajorBumpAllowed()) {
    console.log(
      `Changeset release policy OK: ${majorBumps.length} major version bump(s) allowed by ALLOW_MAJOR_BUMPS.`,
    );
    return;
  }

  console.error('Major version bumps are disabled by release policy.');
  console.error('');
  console.error('Found major changesets:');

  for (const release of majorBumps) {
    const version = release.currentVersion ? ` (${release.currentVersion})` : '';
    console.error(`- ${release.file}: ${release.packageName}${version}`);
  }

  console.error('');
  console.error(
    'A major bump corresponds to a breaking change (describe it with "BREAKING:" in the changeset body). Major bumps are gated so they are never accidental.',
  );
  console.error(
    'Set ALLOW_MAJOR_BUMPS=true only when you intentionally mean to cut a major release.',
  );
  process.exit(1);
}

main();
