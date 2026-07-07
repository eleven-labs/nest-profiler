/**
 * E2E config — boots the real AppModule against live Postgres/Mongo (docker compose up -d).
 * Workspace packages resolve to their `dist/` under jest: rebuild them (`pnpm build`)
 * after changing any `packages/*` source, or assertions run against stale code.
 *
 * Requires Node >= 24.9 and NODE_OPTIONS=--experimental-vm-modules (set by the test:e2e
 * script): the ESM-only @mikro-orm v7 packages load through jest's `require(esm)` support,
 * which needs the synchronous vm module APIs.
 */

// The stress suite (profiler-stress.e2e-spec) runs by default; set PROFILER_STRESS to a
// falsy value (0/false/off/no) to skip its concurrent bursts for a faster local run.
const stressEnabled = !['0', 'false', 'off', 'no'].includes(
  (process.env.PROFILER_STRESS ?? '').trim().toLowerCase(),
);

// E2E_SKIP_HTTP_SPECS: skip content/cli (they depend on HTTP_CLIENT, not SQL_ORM).
const skipHttpClientSpecs = ['1', 'true'].includes(
  (process.env.E2E_SKIP_HTTP_SPECS ?? '').trim().toLowerCase(),
);
const httpClientSpecs = ['content\\.e2e-spec', 'cli\\.e2e-spec'];

// E2E_ORM_DEPENDENT_ONLY: keep only the SQL_ORM-dependent specs (products/graphql/profiler-ui).
const ormDependentOnly = ['1', 'true'].includes(
  (process.env.E2E_ORM_DEPENDENT_ONLY ?? '').trim().toLowerCase(),
);
const ormIndependentSpecs = [
  'auth',
  'health',
  'diagnostics',
  'reviews',
  'profiler-stress',
  'content',
  'cli',
].map((name) => `${name}\\.e2e-spec`);

/** @type {import('jest').Config} */
module.exports = {
  preset: '@repo/jest-config',
  rootDir: '..',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  // Default Jest ignore plus, when stress is disabled, the stress spec.
  testPathIgnorePatterns: [
    '/node_modules/',
    ...(stressEnabled ? [] : ['profiler-stress\\.e2e-spec']),
    ...(skipHttpClientSpecs ? httpClientSpecs : []),
    ...(ormDependentOnly ? ormIndependentSpecs : []),
  ],
  // Empties `.profiler` once per run; the suite's profiles are kept afterwards for browsing.
  globalSetup: '<rootDir>/test/global-setup.ts',
  setupFiles: ['reflect-metadata', '<rootDir>/test/setup-env.ts'],
  // nest-profiler-mikro-orm is ESM-only ("type": "module"): its dist must load natively via
  // require(esm), not be transpiled to CJS by ts-jest like the other (CommonJS) workspace dists.
  transformIgnorePatterns: ['/node_modules/', '/packages/nest-profiler-mikro-orm/dist/'],
  // Every app bootstrap reseeds the shared databases (clear + insert) — spec files must not overlap.
  maxWorkers: 1,
  testTimeout: 30000,
  collectCoverage: false,
  // The shared preset enforces a 90% global threshold meant for unit suites — not applicable here.
  coverageThreshold: {},
};
