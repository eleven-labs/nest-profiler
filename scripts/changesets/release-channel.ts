/**
 * Shared helpers for packages that live on their own npm dist-tag.
 *
 * Changesets has a single, repo-wide prerelease mode (`.changeset/pre.json`):
 * either every package is on a prerelease line, or none is. A package that must
 * stay on `alpha` forever while the rest of the suite ships stable — today
 * `@eleven-labs/nest-profiler-ai` — has no place in that model, and used to be
 * parked in `ignore`, which took it out of versioning, changelog generation and
 * publishing alike.
 *
 * Such a package is instead declared by its own manifest: a `publishConfig.tag`
 * that is not `latest` pins it to that channel. `scripts/changesets/version.ts`
 * rewrites the version Changesets computed for it back onto that prerelease
 * line, and `scripts/changesets/publish.ts` publishes it under that dist-tag.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_DIST_TAG = 'latest';

export type PinnedChannelPackage = {
  name: string;
  version: string;
  /** The dist-tag this package is pinned to, e.g. `alpha`. Never `latest`. */
  distTag: string;
  access: string;
  dir: string;
  manifestPath: string;
  changelogPath: string;
};

type PackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  publishConfig?: { tag?: string; access?: string };
};

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function readPackageJson(manifestPath: string): PackageJson {
  return JSON.parse(readFileSync(manifestPath, 'utf-8')) as PackageJson;
}

/**
 * Every publishable `packages/*` whose manifest pins a non-`latest` dist-tag.
 * Nested workspaces (`packages/configs/*`) are private tooling and never publish.
 */
export function readPinnedChannelPackages(cwd = process.cwd()): PinnedChannelPackage[] {
  const packagesDir = join(cwd, 'packages');
  const pinned: PinnedChannelPackage[] = [];

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const dir = join(packagesDir, entry.name);
    const manifestPath = join(dir, 'package.json');
    if (!existsSync(manifestPath)) continue;

    const packageJson = readPackageJson(manifestPath);
    const distTag = packageJson.publishConfig?.tag;

    if (packageJson.private || !packageJson.name || !packageJson.version) continue;
    if (!distTag || distTag === DEFAULT_DIST_TAG) continue;

    pinned.push({
      name: packageJson.name,
      version: packageJson.version,
      distTag,
      access: packageJson.publishConfig?.access ?? 'public',
      dir,
      manifestPath,
      changelogPath: join(dir, 'CHANGELOG.md'),
    });
  }

  return pinned;
}

export function readActivePrereleaseTag(cwd = process.cwd()): string | null {
  const preStatePath = join(cwd, '.changeset', 'pre.json');

  if (!existsSync(preStatePath)) {
    return null;
  }

  const preState = JSON.parse(readFileSync(preStatePath, 'utf-8')) as {
    mode?: string;
    tag?: string;
  };
  if (preState.mode !== 'pre' || !preState.tag) {
    return null;
  }

  return preState.tag;
}

/**
 * Map the stable version Changesets computed back onto the pinned prerelease
 * line, the same way Changesets itself does in prerelease mode: the bump type
 * decides the base version, the channel counter decides the rest.
 *
 * `1.0.0-alpha.0` + a `minor` bump gives a stable `1.0.0`, same base, so the
 * counter moves: `1.0.0-alpha.1`. A bump that reaches a new base — `2.0.0` —
 * starts that base's own series at `2.0.0-alpha.0`.
 */
export function nextChannelVersion(
  previousVersion: string,
  stableVersion: string,
  distTag: string,
): string {
  const previous = VERSION_PATTERN.exec(previousVersion);
  const stable = VERSION_PATTERN.exec(stableVersion);

  if (!previous) {
    throw new Error(`Unsupported version "${previousVersion}": expected a semver version.`);
  }
  if (!stable) {
    throw new Error(`Unsupported version "${stableVersion}": expected a semver version.`);
  }

  const previousBase = `${previous[1]}.${previous[2]}.${previous[3]}`;
  const stableBase = `${stable[1]}.${stable[2]}.${stable[3]}`;

  if (previousBase !== stableBase) {
    return `${stableBase}-${distTag}.0`;
  }

  return `${stableBase}-${distTag}.${readChannelCounter(previous[4], distTag) + 1}`;
}

/**
 * The `N` of a `-<distTag>.N` prerelease, or `-1` when the version is stable or
 * sits on another channel — either way the pinned series starts over at `.0`.
 */
function readChannelCounter(prerelease: string | undefined, distTag: string): number {
  if (!prerelease) return -1;

  const counter = new RegExp(`^${distTag}\\.(\\d+)$`).exec(prerelease);

  return counter ? Number(counter[1]) : -1;
}
