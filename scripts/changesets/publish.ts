#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CHANNEL_TO_DIST_TAG = {
  stable: 'latest',
  latest: 'latest',
  alpha: 'alpha',
  beta: 'beta',
} as const;

type ReleaseChannel = keyof typeof CHANNEL_TO_DIST_TAG;

type PreState = {
  mode?: string;
  tag?: string;
};

function readActivePrereleaseTag(): string | null {
  const preStatePath = join(process.cwd(), '.changeset', 'pre.json');

  if (!existsSync(preStatePath)) {
    return null;
  }

  const preState = JSON.parse(readFileSync(preStatePath, 'utf-8')) as PreState;
  if (preState.mode !== 'pre' || !preState.tag) {
    return null;
  }

  return preState.tag;
}

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

function run(command: string, args: string[]): number {
  const result = spawnSync(command, args, {
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(result.error.message);
    return 1;
  }

  return result.status ?? 1;
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
