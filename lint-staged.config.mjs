// @ts-check
/**
 * Runs on staged files only (fast). ESLint 9+/10 resolves the config file per
 * linted file (it walks up to the nearest eslint.config.mjs), so running from
 * the repo root still applies each workspace's own config — nestjs for packages,
 * nextjs for docs. `projectService: true` likewise resolves each file's nearest
 * tsconfig for type-aware rules. Prettier honours .prettierignore, so the
 * lockfile and build artifacts are skipped even if staged.
 *
 * @type {import('lint-staged').Configuration}
 */
export default {
  '*.{ts,tsx}': ['eslint --fix --no-warn-ignored', 'prettier --write'],
  '*.{js,cjs,mjs,json,jsonc,md,mdx,yml,yaml,css}': ['prettier --write'],
};
