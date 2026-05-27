// @ts-check
import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import perfectionist from 'eslint-plugin-perfectionist';
import turbo from 'eslint-plugin-turbo';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  perfectionist.configs['recommended-natural'],
  turbo.configs['flat/recommended'],
  {
    rules: {
      // ── Perfectionist overrides ─────────────────────────────────────
      'perfectionist/sort-objects': 'off',     // key order is often intentional
      'perfectionist/sort-classes': 'off',     // member order reflects logical structure
      'perfectionist/sort-switch-case': 'off', // case order can affect fallthrough behavior
      'perfectionist/sort-modules': 'off',     // declaration order can be semantically significant

      // ── Code structure (framework-agnostic) ────────────────────────
      'no-else-return': 'error',
      'no-console': 'error',
      'max-classes-per-file': ['error', 1],
      'complexity': ['error', 10],
      'max-params': ['error', 3],
      'max-nested-callbacks': ['error', 3],
      'max-depth': ['error', 3],
      'max-lines-per-function': [
        'error',
        { max: 60, skipBlankLines: true, skipComments: true },
      ],

      // ── TypeScript (syntax-only, no type analysis required) ─────────
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Spec files: relax function-length rules — describe/it blocks are
    // legitimately long and splitting them harms readability.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    rules: {
      'max-lines-per-function': 'off',
    },
  },
  eslintConfigPrettier, // must be last — disables all ESLint formatting rules that Prettier handles
);
