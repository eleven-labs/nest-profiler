#!/usr/bin/env tsx
/**
 * Verify that each collector package's "Public exports" section lists every symbol its entry
 * point exports.
 *
 * The section is the contract a consumer reads before importing anything, so a symbol that
 * ships but is not listed is either an accidental export or an undocumented one — both worth
 * catching in review rather than after a release, since removing a published export costs a
 * major version.
 *
 *   pnpm check:api-exports
 *
 * The core package is deliberately exempt: it exports well over two hundred symbols, its API
 * reference documents the extension contracts section by section, and its import block is an
 * explicit shortlist ("Commonly imported symbols") rather than an inventory.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGES_DIR = join(process.cwd(), 'packages');
const REFERENCE_DIR = join(process.cwd(), 'docs', 'content', 'docs', 'api-reference');
const SECTION = '## Public exports';

/** Names inside every `export { ... }` / `export type { ... }` clause of a barrel. */
function exportedNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const [, clause] of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/gs)) {
    for (const raw of clause.split(',')) {
      const name = raw
        .trim()
        .replace(/^type\s+/, '')
        .split(' as ')
        .pop()
        ?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/** Names inside every `import { ... }` clause of the section's code blocks. */
function documentedNames(section: string): Set<string> {
  const names = new Set<string>();
  for (const [, clause] of section.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}/gs)) {
    for (const raw of clause.split(',')) {
      const name = raw.trim().replace(/^type\s+/, '');
      if (name) names.add(name);
    }
  }
  return names;
}

const failures: string[] = [];
const packages = readdirSync(PACKAGES_DIR).filter((name) => name.startsWith('nest-profiler-'));

for (const pkg of packages) {
  const barrel = join(PACKAGES_DIR, pkg, 'src', 'index.ts');
  const reference = join(REFERENCE_DIR, `${pkg}.en.mdx`);

  let page: string;
  try {
    page = readFileSync(reference, 'utf-8');
  } catch {
    failures.push(`${pkg}: no API reference page at ${reference}`);
    continue;
  }

  const [, rest] = page.split(SECTION);
  if (rest === undefined) {
    failures.push(`${pkg}: its API reference page has no "${SECTION}" section`);
    continue;
  }

  const documented = documentedNames(rest.split('\n## ')[0] ?? '');
  const missing = [...exportedNames(readFileSync(barrel, 'utf-8'))]
    .filter((name) => !documented.has(name))
    .sort();

  if (missing.length > 0) {
    failures.push(`${pkg}: exported but not listed — ${missing.join(', ')}`);
  }
}

if (failures.length > 0) {
  console.error('API reference "Public exports" sections are out of date:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('\nList the symbol in the section, or stop exporting it from the barrel.');
  process.exit(1);
}

console.log(`Public exports documented for all ${packages.length} collector packages.`);
