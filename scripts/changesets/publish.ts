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

/** Whether this exact version is already on the registry, as Changesets asks it. */
function isAlreadyPublished(pkg: PinnedChannelPackage): boolean {
  const { exitCode, stdout } = capture(
    'pnpm',
    ['info', `${pkg.name}@${pkg.version}`, 'version', '--json'],
    pkg.dir,
  );

  if (exitCode === 0) {
    return stdout.trim().length > 0;
  }

  if (stdout.includes('E404') || stdout.includes('ERR_PNPM_FETCH_404')) {
    return false;
  }

  throw new Error(`Failed to query the registry for ${pkg.name}@${pkg.version}:\n${stdout}`);
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

function publishPinnedChannelPackages(): number {
  for (const pkg of readPinnedChannelPackages()) {
    if (isAlreadyPublished(pkg)) {
      console.log(`${pkg.name}@${pkg.version} is already published, skipping.`);
      continue;
    }

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
