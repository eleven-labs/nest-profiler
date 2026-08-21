// Tests run in a fixed, non-UTC timezone (with DST) so date handling is deterministic across
// machines and CI, and so code that formats a timestamp in UTC instead of the host timezone
// fails here rather than only on a contributor's machine.
process.env.TZ = 'Europe/Paris';

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // Strip `.js` from relative imports so ESM packages' specifiers resolve to their `.ts` source.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        // Force CJS emit so Jest runs in CJS even for ESM packages (`"type": "module"`).
        tsconfig: {
          module: 'CommonJS',
          moduleResolution: 'Node10',
          ignoreDeprecations: '6.0',
          isolatedModules: true,
          resolvePackageJsonExports: false,
        },
      },
    ],
  },
  testEnvironment: 'node',
  setupFiles: ['reflect-metadata'],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};
