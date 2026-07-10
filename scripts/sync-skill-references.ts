#!/usr/bin/env tsx
/**
 * Sync the shared collector reference files across the two consumer skills.
 *
 * `skills/setup-nest-profiler/references/collectors-*.md` is the single source of
 * truth. The `add-nest-profiler-collector` skill must bundle byte-identical copies
 * so it installs standalone (see `skills/README.md`). This script regenerates those
 * copies from the source — never edit the generated ones by hand.
 *
 *   pnpm sync:skill-refs          # write the copies (mirror source → target)
 *   pnpm sync:skill-refs --check  # verify they are in sync (CI); exit 1 on drift
 *
 * The `--check` mode is wired into the Quality workflow so a PR that edits one copy
 * without the other fails fast.
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SKILLS_DIR = join(process.cwd(), 'skills');
const SOURCE_DIR = join(SKILLS_DIR, 'setup-nest-profiler', 'references');
const TARGET_DIR = join(SKILLS_DIR, 'add-nest-profiler-collector', 'references');

/** The collector family references shared verbatim by both skills. */
const isShared = (file: string): boolean => file.startsWith('collectors-') && file.endsWith('.md');

const sourceFiles = readdirSync(SOURCE_DIR).filter(isShared).sort();
const targetOrphans = readdirSync(TARGET_DIR)
  .filter((file) => isShared(file) && !sourceFiles.includes(file))
  .sort();

const check = process.argv.includes('--check');
const drifted: string[] = [];
const written: string[] = [];

for (const file of sourceFiles) {
  const source = readFileSync(join(SOURCE_DIR, file), 'utf8');
  const targetPath = join(TARGET_DIR, file);

  let current: string | null;
  try {
    current = readFileSync(targetPath, 'utf8');
  } catch {
    current = null;
  }

  if (current === source) continue;

  if (check) {
    drifted.push(file);
  } else {
    writeFileSync(targetPath, source);
    written.push(file);
  }
}

for (const file of targetOrphans) {
  if (check) {
    drifted.push(`${file} (not in source)`);
  } else {
    rmSync(join(TARGET_DIR, file));
    written.push(`${file} (removed)`);
  }
}

if (check) {
  if (drifted.length > 0) {
    console.error(
      `Skill references out of sync (${drifted.length}):\n` +
        drifted.map((file) => `  - ${file}`).join('\n') +
        '\n\nRun `pnpm sync:skill-refs` and commit the result.',
    );
    process.exit(1);
  }
  console.log(`Skill references in sync (${sourceFiles.length} files).`);
} else if (written.length > 0) {
  console.log(
    `Synced ${written.length} skill reference(s):\n` +
      written.map((file) => `  - ${file}`).join('\n'),
  );
} else {
  console.log(`Skill references already in sync (${sourceFiles.length} files).`);
}
