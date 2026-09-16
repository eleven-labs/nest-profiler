import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `ai` is ESM-only and this package ships CommonJS, where a value import compiles to a `require()`
 * Node refuses for an ES module:
 *
 *   Error [ERR_REQUIRE_ESM]: require() of ES Module …/ai/dist/index.js … not supported
 *
 * It surfaces only at runtime, in a deployed CommonJS app — the compiler is happy and so is the
 * test run, which forces CommonJS on both sides. So the rule is pinned here instead: `ai` may be
 * imported for its types, which compile to nothing, and reached for its values only through a
 * dynamic `import()`, which both module systems accept.
 */
describe('CommonJS interop with the ESM-only `ai` package', () => {
  const sources = readdirSync(__dirname)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
    .map((name) => [name, readFileSync(join(__dirname, name), 'utf8')] as const);

  it.each(sources)('%s imports no value from `ai`', (_name, source) => {
    // Anchored on a statement: `[^;]*` cannot run past the end of an earlier import.
    const valueImport = /^import\s+(?!type\b)[^;]*from\s+'ai';/m;

    expect(source).not.toMatch(valueImport);
  });

  it('reaches `registerTelemetry` through a dynamic import', () => {
    const module = readFileSync(join(__dirname, 'ai-collector.module.ts'), 'utf8');

    expect(module).toContain("await import('ai')");
  });
});
