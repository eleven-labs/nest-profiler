#!/usr/bin/env tsx
/**
 * Publish the packages `changeset version` bumped.
 *
 * `changeset publish` applies a single dist-tag to the whole run, so packages
 * pinned to their own dist-tag (`publishConfig.tag`, today only the alpha
 * `@eleven-labs/nest-profiler-ai`) would land on `latest` and take over the
 * stable line. The release therefore goes through Changesets' publish plan:
 * the plan is computed once, each pinned package's entry is retagged, and the
 * packed plan is published in a single pass that also creates the git tags and
 * reports them to `changesets/action` through `CHANGESETS_OUTPUT`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readActivePrereleaseTag,
  readPinnedChannelPackages,
  type PinnedChannelPackage,
} from './release-channel';
import { capture, run } from './run';

const CHANNEL_TO_DIST_TAG = {
  stable: 'latest',
  latest: 'latest',
  alpha: 'alpha',
  beta: 'beta',
} as const;

type ReleaseChannel = keyof typeof CHANNEL_TO_DIST_TAG;

function resolveDistTag(): string {
  const requestedChannel = process.argv[2]?.trim();
  const activePrereleaseTag = readActivePrereleaseTag();

  if (requestedChannel) {
    if (!(requestedChannel in CHANNEL_TO_DIST_TAG)) {
      const channels = Object.keys(CHANNEL_TO_DIST_TAG).join(', ');
      console.error(`Unknown release channel "${requestedChannel}". Expected one of: ${channels}.`);
      process.exit(1);
    }

    if (
      (requestedChannel === 'alpha' || requestedChannel === 'beta') &&
      activePrereleaseTag !== requestedChannel
    ) {
      console.error(
        `Release channel "${requestedChannel}" requires active Changesets prerelease mode "${requestedChannel}".`,
      );
      console.error(
        `Run "pnpm changeset:pre:${requestedChannel}" before versioning prerelease packages.`,
      );
      process.exit(1);
    }

    if ((requestedChannel === 'stable' || requestedChannel === 'latest') && activePrereleaseTag) {
      console.error(
        `Stable release is disabled while Changesets prerelease mode "${activePrereleaseTag}" is active.`,
      );
      console.error(
        'Run "pnpm changeset:pre:exit" and version packages before publishing a stable release.',
      );
      process.exit(1);
    }

    return CHANNEL_TO_DIST_TAG[requestedChannel as ReleaseChannel];
  }

  return activePrereleaseTag ?? CHANNEL_TO_DIST_TAG.stable;
}

function assertValidDistTag(distTag: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(distTag)) {
    console.error(`Invalid npm dist-tag "${distTag}".`);
    process.exit(1);
  }
}

type RegistryManifest = {
  versions?: string[];
  'dist-tags'?: Record<string, string>;
};

/** Report a non-fatal problem, as a GitHub Actions annotation when running there. */
function warn(message: string): void {
  console.warn(
    process.env.GITHUB_ACTIONS === 'true' ? `::warning::${message}` : `Warning: ${message}`,
  );
}

/** The `versions` and `dist-tags` the registry holds for `pkg`, or `null` when it holds none. */
function readRegistryManifest(pkg: PinnedChannelPackage): RegistryManifest | null {
  const { exitCode, stdout } = capture('pnpm', ['info', pkg.name, '--json'], pkg.dir);

  if (exitCode !== 0 || stdout.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(stdout) as RegistryManifest;
  } catch {
    return null;
  }
}

/**
 * Keep `latest` on the pinned line until the package has a stable release.
 *
 * npm sets `latest` on a package's first-ever publish and then never moves it
 * for a publish made under another dist-tag, so an `alpha`-pinned package would
 * advertise its first alpha as `latest` forever — `npm install <pkg>` would
 * install an ever-staler prerelease. While every published version is a
 * prerelease, `latest` follows the pinned channel; as soon as a stable version
 * exists it owns `latest`, and the stable publish moves it on its own.
 *
 * Promotion is best-effort: npm's trusted publishing (OIDC) mints a
 * publish-scoped token, and `npm dist-tag add` is not in its scope
 * (npm/cli#8547), so this cannot succeed on CI today. A failure therefore warns
 * with the command to run by hand instead of failing a release whose packages
 * are already on the registry — and the next release retries it, since this runs
 * for packages that were already published too.
 */
function syncLatestDistTag(pkg: PinnedChannelPackage): void {
  const manifest = readRegistryManifest(pkg);

  if (!manifest) {
    warn(`Could not read the dist-tags of ${pkg.name}; left "latest" untouched.`);
    return;
  }

  const versions = manifest.versions ?? [];
  if (versions.some((version) => !version.includes('-'))) {
    return;
  }

  const currentLatest = manifest['dist-tags']?.latest;
  if (currentLatest === pkg.version) {
    return;
  }

  console.log(
    `${pkg.name} has no stable release yet: moving "latest" from ` +
      `${currentLatest ?? '(unset)'} to ${pkg.version}.`,
  );

  const distTagArgs = ['dist-tag', 'add', `${pkg.name}@${pkg.version}`, 'latest'];
  if (run('pnpm', distTagArgs, pkg.dir) !== 0) {
    warn(
      `Could not move the "latest" dist-tag of ${pkg.name} to ${pkg.version} — it still ` +
        `points at ${currentLatest ?? '(unset)'}. Trusted publishing cannot set dist-tags ` +
        `(npm/cli#8547), so run "pnpm ${distTagArgs.join(' ')}" from an authenticated shell.`,
    );
  }
}

type PublishPlanRelease = { kind: string; name: string; tag?: string };

type PublishPlanFile = { version: number; plan: PublishPlanRelease[][] };

/** Put every pinned package of the plan on its own dist-tag, whatever tag Changesets chose. */
function retagPinnedReleases(planPath: string, pinned: PinnedChannelPackage[]): void {
  const distTags = new Map(pinned.map((pkg) => [pkg.name, pkg.distTag]));
  const planFile = JSON.parse(readFileSync(planPath, 'utf-8')) as PublishPlanFile;

  for (const release of planFile.plan.flat()) {
    const distTag = distTags.get(release.name);
    if (release.kind === 'publish' && distTag) {
      console.log(`Publishing ${release.name} with dist-tag "${distTag}".`);
      release.tag = distTag;
    }
  }

  writeFileSync(planPath, `${JSON.stringify(planFile, undefined, 2)}\n`);
}

/** Plan, retag, pack, then publish the packed plan in one `changeset publish` pass. */
function publishFromPlan(workDir: string): number {
  const planPath = join(workDir, 'publish-plan.json');
  const packDir = join(workDir, 'pack');

  let exitCode = run('changeset', ['publish-plan', '--output', planPath]);
  if (exitCode !== 0) {
    return exitCode;
  }

  retagPinnedReleases(planPath, readPinnedChannelPackages());

  exitCode = run('changeset', ['pack', '--from-publish-plan', planPath, '--out-dir', packDir]);
  if (exitCode !== 0) {
    return exitCode;
  }

  return run('changeset', ['publish', '--from-pack-dir', packDir]);
}

function main(): void {
  const distTag = resolveDistTag();
  assertValidDistTag(distTag);

  // Changesets derives the dist-tag itself: `latest` for a stable release, and
  // in prerelease mode `pre.json`'s tag (or `latest` for a package that only
  // has prereleases). A plan cannot carry an explicit `--tag`, and neither can
  // prerelease mode, so the channel resolved here is only validated and logged.
  if (readActivePrereleaseTag() !== null) {
    console.log(
      `Prerelease mode active: Changesets publishes under the "${distTag}" dist-tag ` +
        `(npm also assigns "latest" on a package's first-ever publish).`,
    );
  } else {
    console.log(`Publishing packages with dist-tag "${distTag}".`);
  }

  const workDir = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'changesets-publish-'));
  let exitCode = 0;

  try {
    exitCode = run('tsx', ['scripts/absolutize-readme-images.ts']);

    if (exitCode === 0) {
      exitCode = publishFromPlan(workDir);
    }

    if (exitCode === 0) {
      for (const pkg of readPinnedChannelPackages()) {
        syncLatestDistTag(pkg);
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    const checkoutExitCode = run('git', ['checkout', '--', 'packages/*/README.md']);
    if (exitCode === 0 && checkoutExitCode !== 0) {
      exitCode = checkoutExitCode;
    }
  }

  process.exit(exitCode);
}

main();
