/**
 * E2E config — boots the real AppModule against live Postgres/Mongo (docker compose up -d).
 * Workspace packages resolve to their `dist/` under jest: rebuild them (`pnpm build`)
 * after changing any `packages/*` source, or assertions run against stale code.
 *
 * Requires Node >= 24.9 and NODE_OPTIONS=--experimental-vm-modules (set by the test:e2e
 * script): the ESM-only @mikro-orm v7 packages load through jest's `require(esm)` support,
 * which needs the synchronous vm module APIs.
 */

/** @type {import('jest').Config} */
module.exports = {
  preset: '@repo/jest-config',
  rootDir: '..',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
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
