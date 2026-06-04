// @ts-check
/**
 * Conventional Commits enforcement (matches the existing history and Changesets
 * workflow: feat / fix / chore / docs / ci(scope): subject).
 *
 * @type {import('@commitlint/types').UserConfig}
 */
export default {
  extends: ['@commitlint/config-conventional'],
};
