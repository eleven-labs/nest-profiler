#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const GITHUB_DIR = join(process.cwd(), 'scripts', 'github');

const isUpdate = process.argv.includes('--update');
const mode = isUpdate ? 'update' : 'setup';

type SpawnResult = { stdout: string };

function gh(...args: string[]): SpawnResult {
  const result = spawnSync('gh', args, { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || 'gh command failed');
  }
  return { stdout: result.stdout?.trim() ?? '' };
}

function tryGh(...args: string[]): SpawnResult | null {
  try {
    return gh(...args);
  } catch {
    return null;
  }
}

async function main() {
  console.log(`setup-github — mode: ${mode}\n`);

  // --- Prerequisites ---
  console.log('Checking prerequisites…');

  if (!tryGh('--version')) {
    console.error('Error: gh CLI is not installed. See https://cli.github.com');
    process.exit(1);
  }

  if (!tryGh('auth', 'status')) {
    console.error('Error: gh CLI is not authenticated. Run: gh auth login');
    process.exit(1);
  }

  // --- Repo info ---
  const repoData = JSON.parse(gh('repo', 'view', '--json', 'owner,name').stdout) as {
    owner: { login: string };
    name: string;
  };
  const repoSlug = `${repoData.owner.login}/${repoData.name}`;
  console.log(`Repository: ${repoSlug}\n`);

  const rl = createInterface({ input, output });
  const ask = async (question: string) => (await rl.question(question)).trim();

  let applied = 0;

  // --- Labels ---
  type LabelConfig = { name: string; color: string; description: string };
  const labels = JSON.parse(
    readFileSync(join(GITHUB_DIR, 'labels.json'), 'utf-8'),
  ) as LabelConfig[];

  console.log('Setting up labels…');
  for (const label of labels) {
    try {
      gh(
        'label',
        'create',
        label.name,
        '--color',
        label.color,
        '--description',
        label.description,
        '--force',
      );
      console.log(`  ✓ ${label.name}`);
      applied++;
    } catch (err) {
      console.error(`  ✗ ${label.name}: ${(err as Error).message}`);
    }
  }

  // --- Milestones (setup only) ---
  if (!isUpdate) {
    type MilestoneConfig = { title: string; description?: string; due_on?: string };
    const milestones = JSON.parse(
      readFileSync(join(GITHUB_DIR, 'milestones.json'), 'utf-8'),
    ) as MilestoneConfig[];

    if (milestones.length > 0) {
      console.log('\nSetting up milestones…');
      for (const ms of milestones) {
        try {
          const args = [
            'api',
            '--method',
            'POST',
            `/repos/${repoSlug}/milestones`,
            '--field',
            `title=${ms.title}`,
          ];
          if (ms.description) args.push('--field', `description=${ms.description}`);
          if (ms.due_on) args.push('--field', `due_on=${ms.due_on}`);
          gh(...args);
          console.log(`  ✓ ${ms.title}`);
          applied++;
        } catch (err) {
          console.error(`  ✗ ${ms.title}: ${(err as Error).message}`);
        }
      }
    }
  }

  // --- Branch ruleset ---
  console.log('\nSetting up branch ruleset…');
  const rulesetPath = join(GITHUB_DIR, 'rulesets.json');
  const rulesetConfig = JSON.parse(readFileSync(rulesetPath, 'utf-8')) as { name: string };

  try {
    const existing = JSON.parse(gh('api', `/repos/${repoSlug}/rulesets`).stdout) as Array<{
      id: number;
      name: string;
    }>;
    const found = existing.find((r) => r.name === rulesetConfig.name);

    if (found) {
      gh(
        'api',
        '--method',
        'PUT',
        `/repos/${repoSlug}/rulesets/${found.id}`,
        '--input',
        rulesetPath,
      );
      console.log(`  ✓ Updated "${rulesetConfig.name}"`);
    } else {
      gh('api', '--method', 'POST', `/repos/${repoSlug}/rulesets`, '--input', rulesetPath);
      console.log(`  ✓ Created "${rulesetConfig.name}"`);
    }
    applied++;
  } catch (err) {
    console.error(`  ✗ Ruleset: ${(err as Error).message}`);
  }

  // --- Repository settings ---
  console.log('\nUpdating repository settings…');
  try {
    gh(
      'api',
      '--method',
      'PATCH',
      `/repos/${repoSlug}`,
      '--field',
      'delete_branch_on_merge=true',
      '--field',
      'allow_auto_merge=true',
    );
    console.log('  ✓ Auto-delete head branches on merge');
    console.log('  ✓ Auto-merge enabled');
    applied++;
  } catch (err) {
    console.error(`  ✗ Repository settings: ${(err as Error).message}`);
  }

  // --- Actions variables ---
  console.log('\nConfiguring Actions variables…');
  try {
    if (tryGh('variable', 'get', 'ALLOW_MAJOR_BUMPS')) {
      console.log('  ✓ ALLOW_MAJOR_BUMPS already configured');
    } else {
      gh('variable', 'set', 'ALLOW_MAJOR_BUMPS', '--body', 'false');
      console.log('  ✓ ALLOW_MAJOR_BUMPS = false');
      applied++;
    }
  } catch (err) {
    console.error(`  ✗ ALLOW_MAJOR_BUMPS: ${(err as Error).message}`);
  }

  // --- CODEOWNERS (setup only) ---
  if (!isUpdate) {
    console.log('\nConfiguring CODEOWNERS…');
    const codeownersPath = join(process.cwd(), '.github', 'CODEOWNERS');
    const teamInput = await ask(
      '  Team or username for CODEOWNERS (e.g. my-org/maintainers, Enter to skip): ',
    );

    if (teamInput) {
      try {
        const content = readFileSync(codeownersPath, 'utf-8');
        const updated = content
          .replace(/^# \* @.+$/m, `* @${teamInput}`)
          .replace(/^# Uncomment.*\n/m, '');
        writeFileSync(codeownersPath, updated, 'utf-8');
        console.log(`  ✓ CODEOWNERS activated with @${teamInput}`);
        applied++;
      } catch (err) {
        console.error(`  ✗ CODEOWNERS: ${(err as Error).message}`);
      }
    } else {
      try {
        rmSync(codeownersPath);
        console.log('  – CODEOWNERS removed (no owner configured)');
        applied++;
      } catch (err) {
        console.error(`  ✗ CODEOWNERS removal: ${(err as Error).message}`);
      }
    }
  }

  rl.close();

  console.log(`\nDone — ${applied} action(s) applied.`);
}

main().catch((err: unknown) => {
  console.error('Fatal:', err);
  process.exit(1);
});
