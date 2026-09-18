#!/usr/bin/env tsx
/**
 * `changeset version`, then put every package pinned to its own dist-tag back on
 * its prerelease line.
 *
 * Changesets versions such a package as if it were going stable — `1.0.0-alpha.0`
 * plus any bump gives `1.0.0` — because its prerelease mode is repo-wide and is
 * not active here. Parking the package in `ignore` used to avoid that, at the
 * cost of it never being versioned, never getting a changelog and never being
 * published. It now goes through the normal flow, and this script rewrites the
 * version Changesets computed for it into the next `-<tag>.N` of its channel,
 * in the manifest and in the changelog entry that was just generated.
 *
 * The changelog heading matters beyond cosmetics: `changesets/action` looks the
 * released version up in `CHANGELOG.md` to build the GitHub release, and fails
 * the run when it cannot find that entry.
 *
 * In repo-wide prerelease mode Changesets already produces `-<tag>.N` versions
 * for every package, so this script only runs `changeset version` and stops.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';

import {
  nextChannelVersion,
  readActivePrereleaseTag,
  readPackageJson,
  readPinnedChannelPackages,
  type PinnedChannelPackage,
} from './release-channel';
import { run } from './run';

function rewriteManifestVersion(pkg: PinnedChannelPackage, from: string, to: string): void {
  const manifest = readFileSync(pkg.manifestPath, 'utf-8');
  const rewritten = manifest.replace(
    `"version": ${JSON.stringify(from)}`,
    `"version": ${JSON.stringify(to)}`,
  );

  if (rewritten === manifest) {
    throw new Error(
      `Could not find version "${from}" in ${relative(process.cwd(), pkg.manifestPath)}.`,
    );
  }

  writeFileSync(pkg.manifestPath, rewritten);
}

/** Retitle the entry `changeset version` just wrote at the top of the changelog. */
function rewriteChangelogHeading(pkg: PinnedChannelPackage, from: string, to: string): void {
  let changelog: string;
  try {
    changelog = readFileSync(pkg.changelogPath, 'utf-8');
  } catch {
    return; // no changelog to retitle (changelogs disabled, or a dependency-only bump)
  }

  const heading = `\n## ${from}\n`;
  const headingIndex = changelog.indexOf(heading);

  if (headingIndex === -1) {
    throw new Error(
      `Could not find the "## ${from}" entry in ${relative(process.cwd(), pkg.changelogPath)}.`,
    );
  }

  writeFileSync(
    pkg.changelogPath,
    `${changelog.slice(0, headingIndex)}\n## ${to}\n${changelog.slice(headingIndex + heading.length)}`,
  );
}

function main(): void {
  const pinnedPackages = readPinnedChannelPackages();
  const versionsBefore = new Map(pinnedPackages.map((pkg) => [pkg.name, pkg.version]));

  const exitCode = run('changeset', ['version']);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }

  const activePrereleaseTag = readActivePrereleaseTag();
  if (activePrereleaseTag) {
    console.log(
      `Prerelease mode "${activePrereleaseTag}" is active: Changesets already versioned every package as a prerelease.`,
    );
    return;
  }

  for (const pkg of pinnedPackages) {
    const previousVersion = versionsBefore.get(pkg.name)!;
    const stableVersion = readPackageJson(pkg.manifestPath).version;

    if (!stableVersion || stableVersion === previousVersion) {
      continue; // no changeset touched this package in this run
    }

    const channelVersion = nextChannelVersion(previousVersion, stableVersion, pkg.distTag);

    rewriteManifestVersion(pkg, stableVersion, channelVersion);
    rewriteChangelogHeading(pkg, stableVersion, channelVersion);

    console.log(
      `Kept ${pkg.name} on the "${pkg.distTag}" channel: ${previousVersion} -> ${channelVersion} (Changesets computed ${stableVersion}).`,
    );
  }
}

main();
