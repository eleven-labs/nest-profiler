// Tests run in a fixed, non-UTC timezone (with DST) so date handling is deterministic across
// machines and CI, and so code that formats a timestamp in UTC instead of the host timezone
// fails here rather than only on a contributor's machine.
process.env.TZ = 'Europe/Paris';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

// NestJS 12 ships ESM only, NestJS 11 CommonJS (see `pnpm nestjs:use`). Jest runs from the package
// directory: read the installed `@nestjs/common` there. A package without it compiles them anyway.
function isNestEsmOnly() {
  try {
    const manifest = join(process.cwd(), 'node_modules/@nestjs/common/package.json');
    return JSON.parse(readFileSync(manifest, 'utf8')).type === 'module';
  } catch {
    return true;
  }
}

// ESM-only dependencies: NestJS 12 (every `@nestjs/*` package) and content-disposition@3 (pulled
// in by @fastify/static). Jest only `require()`s ESM natively when `vm.SourceTextModule` can
// evaluate synchronously (Node 24.9+ run with `--experimental-vm-modules`). Otherwise compile them
// to CJS so suites still run; when Jest loads them as ESM, a CJS build would break them.
const ESM_ONLY_DEPS = [...(isNestEsmOnly() ? ['@nestjs'] : []), 'content-disposition'];
const jestRequiresEsm = typeof vm.SourceTextModule?.prototype.hasAsyncGraph === 'function';
const compileEsmOnlyDeps = !jestRequiresEsm;
// pnpm stores `@scope/name@x` under `.pnpm/@scope+name@x/node_modules/@scope/name`: match both.
const esmDepsLookahead = ESM_ONLY_DEPS.flatMap((dep) => [`\\.pnpm/${dep}[+@]`, `${dep}/`]).join(
  '|',
);

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // Turbo already runs up to 10 packages at once, and Jest's default starts one worker per core but
  // one in each of them: on a 22-core machine `pnpm test` reached 11-16 GB. Two workers per package
  // keep it around 4 GB without slowing the run down.
  maxWorkers: 2,
  // Recycle a worker that retains more than this between two test files, instead of letting it
  // grow until the end of the suite.
  workerIdleMemoryLimit: '800MB',
  // Strip `.js` from relative imports so ESM packages' specifiers resolve to their `.ts` source.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  ...(compileEsmOnlyDeps && {
    transformIgnorePatterns: [`/node_modules/(?!${esmDepsLookahead})`],
  }),
  transform: {
    ...(compileEsmOnlyDeps && {
      [`/node_modules/(?:${ESM_ONLY_DEPS.join('|')})/.+\\.js$`]:
        require.resolve('./esm-to-cjs-transformer'),
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
