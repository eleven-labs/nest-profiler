#!/usr/bin/env tsx
/**
 * Points the `latest` dist-tag at the locally versioned prerelease, so that a bare
 * `npm install <pkg>` resolves to the newest alpha/beta as long as no stable
 * version exists yet.
 *
 * Run this from your machine after a release has been published, with your own
 * `npm login`: npm trusted publishing (OIDC) only authenticates `npm publish`, so
 * the release workflow deliberately holds no npm credential and cannot move a
 * dist-tag. Keeping this step manual avoids storing a long-lived publish-capable
 * token in CI.
 *
 * Two-factor: the registry accepts the same OTP for several writes inside its
 * validity window — this is how `changeset publish` handles a multi-package
 * release. So every read happens first, the OTP is asked for once, and the
 * dist-tag writes are then fired concurrently to stay well inside that window.
 * Pass --otp=<code> (or set NPM_CONFIG_OTP) to skip the prompt; leave the prompt
 * empty when the npm account requires 2FA for authorization only.
 *
 * Safety rails:
 * - runs only while Changesets prerelease mode is active;
 * - skips any package whose `latest` already points at a stable version, so it
 *   turns into a no-op on its own once 1.0.0 ships;
 * - skips any local version that is not published yet.
 *
 * Pass --dry-run to print the planned moves without touching the registry.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';

type WorkspacePackage = { name: string; version: string };

type PlannedMove = { name: string; version: string; currentLatest: string | null };

type PreState = { mode?: string; tag?: string };

type PackageJson = { name?: string; version?: string; private?: boolean };

const REGISTRY = 'https://registry.npmjs.org';
const PACKAGES_DIR = join(process.cwd(), 'packages');

const execFileAsync = promisify(execFile);

function readActivePrereleaseTag(): string | null {
  const preStatePath = join(process.cwd(), '.changeset', 'pre.json');

  if (!existsSync(preStatePath)) {
    return null;
  }

  const preState = JSON.parse(readFileSync(preStatePath, 'utf-8')) as PreState;

  return preState.mode === 'pre' && preState.tag ? preState.tag : null;
}

function readWorkspacePackages(): WorkspacePackage[] {
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(PACKAGES_DIR, entry.name, 'package.json'))
    .filter((manifestPath) => existsSync(manifestPath))
    .map((manifestPath) => JSON.parse(readFileSync(manifestPath, 'utf-8')) as PackageJson)
    .filter(
      (manifest): manifest is Required<Pick<PackageJson, 'name' | 'version'>> =>
        Boolean(manifest.name && manifest.version) &&
        !manifest.private &&
        !manifest.name!.startsWith('@repo/'),
    )
    .map(({ name, version }) => ({ name, version }));
}

async function npmView(specifier: string, field: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'npm',
      ['view', specifier, field, '--registry', REGISTRY],
      { encoding: 'utf-8' },
    );

    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function isPrerelease(version: string): boolean {
  return version.includes('-');
}

/** Resolves every registry read up front, so the OTP window only covers the writes. */
async function planMoves(prereleaseTag: string): Promise<PlannedMove[]> {
  const decisions = await Promise.all(
    readWorkspacePackages().map(async ({ name, version }): Promise<PlannedMove | null> => {
      if (!isPrerelease(version)) {
        console.log(`Skipping ${name}: local version ${version} is not a prerelease.`);
        return null;
      }

      const [publishedVersion, currentLatest] = await Promise.all([
        npmView(`${name}@${version}`, 'version'),
        npmView(`${name}@latest`, 'version'),
      ]);

      if (!publishedVersion) {
        console.log(`Skipping ${name}: ${version} is not published on npm yet.`);
        return null;
      }

      if (currentLatest && !isPrerelease(currentLatest)) {
        console.log(
          `Skipping ${name}: "latest" already points at the stable ${currentLatest}. ` +
            `The ${prereleaseTag} release stays on its own dist-tag.`,
        );
        return null;
      }

      if (currentLatest === version) {
        console.log(`${name}@${version} is already tagged "latest".`);
        return null;
      }

      return { name, version, currentLatest };
    }),
  );

  return decisions.filter((move): move is PlannedMove => move !== null);
}

async function resolveOtp(): Promise<string | null> {
  const fromArgv = process.argv.find((arg) => arg.startsWith('--otp='))?.slice('--otp='.length);
  const otp = [fromArgv, process.env.NPM_CONFIG_OTP]
    .map((candidate) => candidate?.trim())
    .find((candidate) => Boolean(candidate));

  if (otp) {
    return otp;
  }

  if (!process.stdin.isTTY) {
    return null;
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const answer = await readline.question(
      'npm one-time password (leave empty if your account does not require 2FA for writes): ',
    );

    return answer.trim() || null;
  } finally {
    readline.close();
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prereleaseTag = readActivePrereleaseTag();

  if (!prereleaseTag) {
    console.log('Changesets prerelease mode is not active — "latest" is already set by publish.');
    return;
  }

  const moves = await planMoves(prereleaseTag);

  if (moves.length === 0) {
    console.log('Nothing to promote.');
    return;
  }

  for (const { name, version, currentLatest } of moves) {
    console.log(
      `${dryRun ? '[dry-run] ' : ''}${name}: "latest" ${currentLatest ?? '(unset)'} -> ${version}`,
    );
  }

  if (dryRun) {
    return;
  }

  const otp = await resolveOtp();
  const otpArgs = otp ? ['--otp', otp] : [];

  const results = await Promise.all(
    moves.map(async ({ name, version }) => {
      try {
        await execFileAsync(
          'npm',
          ['dist-tag', 'add', `${name}@${version}`, 'latest', '--registry', REGISTRY, ...otpArgs],
          { encoding: 'utf-8' },
        );

        console.log(`Tagged ${name}@${version} as "latest".`);
        return null;
      } catch (cause) {
        console.error(`Failed to tag ${name}@${version}:`);
        console.error((cause as { stderr?: string }).stderr ?? String(cause));
        return `${name}@${version}`;
      }
    }),
  );

  const failures = results.filter((entry): entry is string => entry !== null);

  if (failures.length > 0) {
    console.error(
      `Failed to move the "latest" dist-tag for: ${failures.join(', ')}. ` +
        'Re-run the command — it only retries what is still pending.',
    );
    process.exit(1);
  }
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
