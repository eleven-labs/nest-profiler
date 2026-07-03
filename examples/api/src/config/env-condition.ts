/**
 * Helpers that build `(env) => boolean` conditions for `ConditionalModule.registerWhen`.
 *
 * NestJS logs a `registerWhen` condition via `String(condition)` at debug level, which by
 * default dumps the whole function body. Each helper overrides `toString()` with a short
 * label (the env variable name), so the debug logs read e.g. `FEATURE_MONGOOSE` instead.
 */
export type EnvCondition = (env: NodeJS.ProcessEnv) => boolean;

/** Wraps a predicate with a `toString()` label so ConditionalModule debug logs stay readable. */
export const labeledCondition = (label: string, predicate: EnvCondition): EnvCondition => {
  const condition: EnvCondition = (env) => predicate(env);
  condition.toString = () => label;
  return condition;
};

/** On only when the variable is exactly `'true'` (opt-in; default off). */
export const enabledWhenTrue = (varName: string): EnvCondition =>
  labeledCondition(varName, (env) => env[varName] === 'true');

/** On unless the variable is exactly `'false'` (opt-out; default on). */
export const enabledUnlessFalse = (varName: string): EnvCondition =>
  labeledCondition(varName, (env) => env[varName] !== 'false');

/** Negates a condition, keeping a readable label (`!LABEL`). */
export const not = (condition: EnvCondition): EnvCondition =>
  labeledCondition(`!${String(condition)}`, (env) => !condition(env));
