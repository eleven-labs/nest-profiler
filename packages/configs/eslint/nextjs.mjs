// @ts-check
import nextPlugin from '@next/eslint-plugin-next';
import betterTailwindcss from 'eslint-plugin-better-tailwindcss';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import baseConfig from './base.mjs';

/**
 * @param {{ tailwindEntryPoint?: string }} [options]
 */
export default (options = {}) =>
  tseslint.config(
    { ignores: ['.next/**', '.source/**', 'node_modules/**'] },
    ...baseConfig,
    nextPlugin.configs.recommended,
    {
      plugins: {
        'react-hooks': reactHooks,
      },
      rules: {
        ...reactHooks.configs.recommended.rules,
      },
    },
    {
      ...betterTailwindcss.configs.recommended,
      settings: {
        'better-tailwindcss': {
          entryPoint: options.tailwindEntryPoint ?? './app/global.css',
        },
      },
    },
    {
      rules: {
        // Prettier owns line-wrapping decisions; this rule conflicts with it.
        'better-tailwindcss/enforce-consistent-line-wrapping': 'off',
      },
    },
    {
      // React components infer their return type (JSX.Element / ReactNode) —
      // explicit annotations add noise without safety benefit here.
      // Components are also legitimately longer than back-end functions.
      rules: {
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        'max-lines-per-function': 'off',
      },
    },
    {
      languageOptions: {
        globals: {
          ...globals.browser,
          ...globals.node,
        },
      },
    },
  );
