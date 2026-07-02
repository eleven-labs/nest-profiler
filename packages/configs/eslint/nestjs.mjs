// @ts-check
import eslint from '@eslint/js';
import checkFile from 'eslint-plugin-check-file';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default (dirname) =>
  tseslint.config(
    { ignores: ['eslint.config.mjs', 'eslint.config.js'] },
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        globals: {
          ...globals.node,
          ...globals.jest,
        },
        sourceType: 'commonjs',
        parserOptions: {
          projectService: true,
          tsconfigRootDir: dirname,
        },
      },
      // Type-aware rules — require projectService: true
      rules: {
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-unsafe-argument': 'error',
        '@typescript-eslint/no-unsafe-assignment': 'error',
        '@typescript-eslint/require-await': 'error',
        '@typescript-eslint/prefer-nullish-coalescing': 'error',
        '@typescript-eslint/prefer-optional-chain': 'error',
        // Re-declared here to override recommendedTypeChecked's stricter default
        // which lacks the ignore patterns defined in base.mjs.
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
      plugins: {
        'check-file': checkFile,
      },
      rules: {
        // NestJS decorator order is semantically significant (e.g. @UseGuards position relative to @Get).
        'perfectionist/sort-decorators': 'off',
        // All TypeScript files must follow kebab-case naming.
        // Middle extensions (.module, .service, .controller, .dto, .entity,
        // .guard, .pipe, .interceptor, .filter, .middleware, .decorator,
        // .repository, .factory, .builder, .resolver, .gateway, .strategy,
        // .schema, .enum, .interface, .type, .config, .spec, .e2e-spec …)
        // are ignored so only the base segment is validated.
        'check-file/filename-naming-convention': [
          'error',
          {
            '**/*.ts': 'KEBAB_CASE',
          },
          {
            ignoreMiddleExtensions: true,
          },
        ],
        // All source directories must follow kebab-case naming.
        'check-file/folder-naming-convention': [
          'error',
          {
            '**': 'KEBAB_CASE',
          },
        ],
      },
    },
    {
      // Browser client bundles: authored as ES modules and type-checked against the
      // DOM lib via each package's src/client/tsconfig.json (the ESLint projectService
      // picks it up). No Node/Jest globals, no server-side rules here.
      files: ['**/src/client/**/*.ts'],
      languageOptions: {
        sourceType: 'module',
        globals: {
          ...globals.browser,
        },
      },
    },
  );
