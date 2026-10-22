// Compiles an ESM-only dependency to CommonJS so Jest can `require()` it on runtimes where it
// cannot load ESM natively. Two ESM idioms break once wrapped in a CommonJS module, so they are
// rewritten before ts-jest compiles the import/export syntax:
// - `createRequire(import.meta.url)` becomes the wrapper's own `require`, so lazily loaded
//   packages stay in Jest's module registry (a native `require` would bypass it and its mocks);
// - `const require = …` would redeclare the wrapper's `require`: it is renamed;
// - any other `import.meta.url` (a syntax error there) becomes the file's own URL.
const { createRequire } = require('node:module');

const TS_JEST_OPTIONS = {
  tsconfig: { allowJs: true, module: 'CommonJS', isolatedModules: true },
};
const CREATE_REQUIRE = /\bcreateRequire\(import\.meta\.url\)/g;
const IMPORT_META_URL = /\bimport\.meta\.url\b/g;
const FILE_URL = "require('node:url').pathToFileURL(__filename).href";
const REQUIRE_DECLARATION = /\b(const|let|var)\s+require\s*=/g;

let tsJest;

// ts-jest is a dependency of each consuming package, not of this preset: resolve it from there.
function getTsJest(rootDir) {
  tsJest ??= createRequire(`${rootDir}/package.json`)('ts-jest').default.createTransformer(
    TS_JEST_OPTIONS,
  );
  return tsJest;
}

const rewrite = (source) =>
  source
    .replace(CREATE_REQUIRE, 'require')
    .replace(IMPORT_META_URL, FILE_URL)
    .replace(REQUIRE_DECLARATION, '$1 esmRequire =');

module.exports = {
  process(source, filename, options) {
    return getTsJest(options.config.rootDir).process(rewrite(source), filename, options);
  },
  getCacheKey(source, filename, options) {
    return getTsJest(options.config.rootDir).getCacheKey(rewrite(source), filename, options);
  },
};
