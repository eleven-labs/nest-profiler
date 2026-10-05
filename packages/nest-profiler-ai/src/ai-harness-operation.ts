/**
 * The operation id a `HarnessAgent` turn reports on its start event, where `generateText` reports
 * `ai.generateText`. It is what tells a harness turn apart from any other generation.
 */
export const HARNESS_OPERATION = 'ai.harness';

/**
 * The framework a harness turn ran under, read off an operation's start event: the provider the
 * harness reports itself as — `harness:claude-code`, `harness:codex` — or `undefined` for anything
 * that is not a harness turn.
 *
 * Only the event is read, so recognising a harness turn costs the collector no dependency: the
 * agent reaches the profiler at all only once `HarnessInstrumentation` is installed.
 */
export function harnessFrameworkOf(event: Record<string, unknown>): string | undefined {
  if (event['operationId'] !== HARNESS_OPERATION) return undefined;
  const provider = event['provider'];
  return typeof provider === 'string' && provider !== '' ? provider : 'harness';
}
