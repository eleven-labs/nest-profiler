import { escapeRegExp } from '../utils/regexp.utils';

/**
 * Name matching for the automatic instrumentation's `exclude` option.
 *
 * Two levels, told apart by the dot: a pattern matching the **class name** takes the provider off
 * the trace entirely — it is never proxied, so it costs nothing at all — while one matching a
 * **`Class.method`** label drops that single method and leaves the rest of the class recorded.
 */
export interface ExcludeMatcher {
  /** Whether the whole provider is excluded. */
  matchesClass(className: string): boolean;
  /** Whether one `Class.method` label is excluded. */
  matchesMethod(label: string): boolean;
}

/**
 * Compiles the user's patterns once, at bootstrap, into the two tests the instrumentation runs.
 *
 * Returns `undefined` when nothing usable was given, which is what lets the hot path skip the
 * matching entirely rather than call into an always-false predicate.
 */
export function compileExcludeMatcher(
  patterns: readonly (string | RegExp)[] | undefined,
): ExcludeMatcher | undefined {
  if (patterns === undefined || patterns.length === 0) return undefined;

  const classTests: RegExp[] = [];
  const methodTests: RegExp[] = [];

  for (const pattern of patterns) {
    if (pattern instanceof RegExp) {
      // Tried at both levels, so /Repository/ drops every repository while /^Foo\.bar$/ drops one
      // method — the pattern's own anchoring says which it meant.
      const test = stateless(pattern);
      classTests.push(test);
      methodTests.push(test);
      continue;
    }
    const trimmed = pattern.trim();
    if (trimmed === '') continue;
    (trimmed.includes('.') ? methodTests : classTests).push(toRegExp(trimmed));
  }

  if (classTests.length === 0 && methodTests.length === 0) return undefined;

  return {
    matchesClass: (className) => classTests.some((test) => test.test(className)),
    matchesMethod: (label) => methodTests.some((test) => test.test(label)),
  };
}

/**
 * Compiles a string pattern: matched in full, with `*` as the only metacharacter.
 *
 * Anchored, so `'Product'` does not take `ProductRepository` with it. `*` stands for a run of
 * characters *within* a name and never crosses the dot, which is what keeps `'*.get'` a method
 * pattern rather than a way of matching anything at all.
 */
function toRegExp(pattern: string): RegExp {
  const source = pattern.split('*').map(escapeRegExp).join('[^.]*');
  return new RegExp(`^${source}$`);
}

/**
 * Drops the `g` and `y` flags from a user RegExp.
 *
 * Both make `test` advance `lastIndex`, so the same pattern would match on one call and miss on
 * the next — a provider recorded or not depending on how many methods were read before it.
 */
function stateless(pattern: RegExp): RegExp {
  const flags = pattern.flags.replace(/[gy]/g, '');
  return flags === pattern.flags ? pattern : new RegExp(pattern.source, flags);
}
