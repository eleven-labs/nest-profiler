// Tests run in a fixed, non-UTC timezone (with DST) so date handling is deterministic across
// machines and CI, and so code that formats a timestamp in UTC instead of the host timezone
// fails here rather than only on a contributor's machine.
process.env.TZ = 'Europe/Paris';

// content-disposition@3 (pulled in by @fastify/static) ships ESM only, and Jest can only
// `require()` ESM from Node 24.9 on. Below that, compile it to CJS so suites booting Fastify still
// run; from 24.9 on Jest loads it as ESM, which a CJS build would break.
const [major, minor] = process.versions.node.split('.').map(Number);
const compileEsmOnlyDeps = major < 24 || (major === 24 && minor < 9);

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // Strip `.js` from relative imports so ESM packages' specifiers resolve to their `.ts` source.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  ...(compileEsmOnlyDeps && {
    transformIgnorePatterns: [
      '/node_modules/(?!\\.pnpm/content-disposition@|content-disposition/)',
    ],
  }),
  transform: {
    ...(compileEsmOnlyDeps && {
      '/content-disposition/.+\\.js$': [
        'ts-jest',
        { tsconfig: { allowJs: true, module: 'CommonJS', isolatedModules: true } },
      ],
    }),
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
