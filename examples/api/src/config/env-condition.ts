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

/** Enabled when the variable is truthy and not equal to `'false'`; otherwise falls back to `defaultValue`. */
export const enabled = (variableName: string, defaultValue = false): EnvCondition =>
  labeledCondition(variableName, (environment) => {
    const value = environment[variableName] ?? defaultValue;

    return value !== 'false' && Boolean(value);
  });

/** Negates a condition, keeping a readable label (`!LABEL`). */
export const not = (condition: EnvCondition): EnvCondition =>
  labeledCondition(`!${String(condition)}`, (env) => !condition(env));
