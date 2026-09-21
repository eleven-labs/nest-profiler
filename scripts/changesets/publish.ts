#!/usr/bin/env tsx
/**
 * Publish the packages `changeset version` bumped.
 *
 * Packages pinned to their own dist-tag (`publishConfig.tag`, today only the
 * alpha `@eleven-labs/nest-profiler-ai`) are published first, one by one, under
 * that tag: `changeset publish` applies a single dist-tag to the whole run, so
 * an alpha caught in a stable release would land on `latest` and take over the
 * stable line. Changesets then skips them — it publishes what the registry does
 * not have yet — and ships the rest under the release channel's dist-tag.
 */
import { appendFileSync } from 'node:fs';

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

/**
 * Registry answers that mean "nothing published under that spec" rather than
 * "the lookup itself failed". A package the registry has never seen and a
 * version missing from a package it does know are reported differently, and the
 * code depends on whether pnpm resolved the spec itself or delegated to npm.
 */
const NOT_PUBLISHED_ERROR_CODES = [
  'E404',
  'ERR_PNPM_FETCH_404',
  'ERR_PNPM_PACKAGE_NOT_FOUND',
  'ERR_PNPM_NO_MATCHING_VERSION',
];

/** Whether this exact version is already on the registry, as Changesets asks it. */
function isAlreadyPublished(pkg: PinnedChannelPackage): boolean {
  const { exitCode, stdout, stderr } = capture(
    'pnpm',
    ['info', `${pkg.name}@${pkg.version}`, 'version', '--json'],
    pkg.dir,
  );

  if (exitCode === 0) {
    return stdout.trim().length > 0;
  }

  const output = `${stdout}\n${stderr}`;
  if (NOT_PUBLISHED_ERROR_CODES.some((code) => output.includes(code))) {
    return false;
  }

  throw new Error(`Failed to query the registry for ${pkg.name}@${pkg.version}:\n${output.trim()}`);
}

/**
 * Tag the release the way Changesets would, and report it to the runner.
 *
 * `changesets/action` reads the NDJSON event stream at `CHANGESETS_OUTPUT` to
 * know what was published: it pushes a git tag and cuts a GitHub release for
 * every `git-tag` event. A package published outside `changeset publish` has to
 * announce itself there, or it silently ends up on npm with no tag and no
 * release notes.
 */
function tagRelease(pkg: PinnedChannelPackage): number {
  const tag = `${pkg.name}@${pkg.version}`;

  if (capture('git', ['tag', '-l', tag]).stdout.trim() === '') {
    const exitCode = run('git', ['tag', tag, '-m', tag]);
    if (exitCode !== 0) {
      return exitCode;
    }
  }

  const outputPath = process.env.CHANGESETS_OUTPUT;
  if (outputPath) {
    appendFileSync(
      outputPath,
      `${JSON.stringify({ type: 'git-tag', tag, packageName: pkg.name })}\n`,
    );
  }

  return 0;
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

function publishPinnedChannelPackages(): number {
  for (const pkg of readPinnedChannelPackages()) {
    if (isAlreadyPublished(pkg)) {
      console.log(`${pkg.name}@${pkg.version} is already published, skipping.`);
    } else {
      console.log(`Publishing ${pkg.name}@${pkg.version} with dist-tag "${pkg.distTag}".`);

      const exitCode = run(
        'pnpm',
        ['publish', '--access', pkg.access, '--tag', pkg.distTag, '--no-git-checks'],
        pkg.dir,
      );
      if (exitCode !== 0) {
        return exitCode;
      }

      const tagExitCode = tagRelease(pkg);
      if (tagExitCode !== 0) {
        return tagExitCode;
      }
    }

    syncLatestDistTag(pkg);
  }

  return 0;
}

function main(): void {
  const distTag = resolveDistTag();
  assertValidDistTag(distTag);

  // In Changesets prerelease mode, `changeset publish` rejects an explicit
  // `--tag` ("Releasing under custom tag is not allowed in pre mode") because it
  // derives the dist-tag per package itself: packages with a prior stable release
  // (or never published) go to `pre.json`'s tag, while prerelease-only packages
  // fall back to `latest`. So we only pass `--tag` for stable releases.
  const inPrereleaseMode = readActivePrereleaseTag() !== null;

  if (inPrereleaseMode) {
    console.log(
      `Prerelease mode active: Changesets publishes under the "${distTag}" dist-tag ` +
        `(npm also assigns "latest" on a package's first-ever publish).`,
    );
  } else {
    console.log(`Publishing packages with dist-tag "${distTag}".`);
  }

  const publishArgs = inPrereleaseMode ? ['publish'] : ['publish', '--tag', distTag];

  let exitCode = 0;

  try {
    exitCode = run('tsx', ['scripts/absolutize-readme-images.ts']);

    if (exitCode === 0) {
      exitCode = publishPinnedChannelPackages();
    }

    if (exitCode === 0) {
      exitCode = run('changeset', publishArgs);
    }
  } finally {
    const checkoutExitCode = run('git', ['checkout', '--', 'packages/*/README.md']);
    if (exitCode === 0 && checkoutExitCode !== 0) {
      exitCode = checkoutExitCode;
    }
  }

  process.exit(exitCode);
}

main();
