import { Injectable } from '@nestjs/common';
import type { Telemetry } from 'ai';
import { instrumentAgentMethods } from '../ai-agent';
import type { AiInstrumentation } from '../ai-instrumentation.interface';

/** Every method of `HarnessAgent` that runs a turn — the two resuming a suspended one included. */
const HARNESS_METHODS = ['generate', 'stream', 'continueGenerate', 'continueStream'] as const;

/** Marks the `HarnessAgent` prototype as instrumented, so a second application instance does not stack. */
const INSTRUMENTED = Symbol.for('@eleven-labs/nest-profiler-ai.harness-instrumented');

/** The part of a `HarnessAgent`'s settings the instrumentation reads and completes. */
interface TelemetrySettings {
  isEnabled?: boolean;
  integrations?: Telemetry | readonly Telemetry[];
  [key: string]: unknown;
}

interface HarnessAgentShape {
  settings?: { telemetry?: TelemetrySettings; [key: string]: unknown };
}

/**
 * The telemetry settings a `HarnessAgent` needs for its turns to reach `integration`, or
 * `undefined` when the ones it has already do.
 *
 * A `HarnessAgent` differs from `generateText` in one way that matters here: without a `telemetry`
 * setting it reports to nobody — not even to the integrations registered with
 * `registerTelemetry`. So the profiler hands its own integration in, and only its own: an
 * application that left telemetry off keeps every other integration it registered out of it.
 *
 * An agent that switched telemetry off (`isEnabled: false`) stays off, as a `generateText` call
 * would; one reporting to the global integrations already reaches the profiler's; one with its
 * own integrations gets the profiler's added to them.
 */
export function harnessTelemetryFor(
  telemetry: TelemetrySettings | undefined,
  integration: Telemetry,
): TelemetrySettings | undefined {
  if (telemetry === undefined || telemetry === null) return { integrations: [integration] };
  if (telemetry.isEnabled === false) return undefined;
  const local = telemetry.integrations;
  if (local === undefined || local === null) return undefined;
  const list: readonly Telemetry[] = Array.isArray(local) ? local : [local as Telemetry];
  if (list.includes(integration)) return undefined;
  return { ...telemetry, integrations: [...list, integration] };
}

/**
 * Teaches every `HarnessAgent` in the process to report its turns to the profiler and to name
 * itself in the profiles it produces — the harness counterpart of `instrumentAgentClass`.
 *
 * Nothing at a call site changes: a turn is attributed from the `id` the agent already declares
 * (`new HarnessAgent({ id: 'coding-agent', … })`), and its model calls and tool executions — the
 * runtime's own built-in tools included — land in the AI panel like those of any other
 * generation.
 *
 * The agent's settings are completed once, on its first turn, with the profiler's integration;
 * nothing else about them changes.
 *
 * @param agentClass The SDK's `HarnessAgent`, resolved at runtime.
 * @param integration The telemetry integration the profiler registered.
 * @returns whether this call instrumented the class — `false` if it was already done, or if what
 *   was passed is not a class.
 */
export function instrumentHarnessAgentClass(agentClass: unknown, integration: Telemetry): boolean {
  return instrumentAgentMethods(agentClass, {
    methods: HARNESS_METHODS,
    marker: INSTRUMENTED,
    prepare: (agent) => {
      const settings = (agent as HarnessAgentShape).settings;
      if (typeof settings !== 'object' || settings === null) return;
      const telemetry = harnessTelemetryFor(settings.telemetry, integration);
      if (telemetry === undefined) return;
      // A copy rather than a write into the object the application passed in, which it may share
      // between agents or keep using itself.
      (agent as HarnessAgentShape).settings = { ...settings, telemetry };
    },
  });
}

/**
 * Profiles the turns of every `HarnessAgent` (`@ai-sdk/harness/agent`) — Claude Code, Codex or any
 * other coding-agent runtime driven through the AI SDK — alongside the application's own
 * generations:
 *
 * ```ts
 * import { HarnessInstrumentation } from '@eleven-labs/nest-profiler-ai/harness';
 *
 * AiCollectorModule.forRoot({ instrumentations: [HarnessInstrumentation] });
 * ```
 *
 * It lives on its own subpath so that an application that does not use `@ai-sdk/harness` never
 * loads a line of it. `@ai-sdk/harness` is an optional peer dependency, imported when this
 * instrumentation is installed — never by the package's main entry.
 */
@Injectable()
export class HarnessInstrumentation implements AiInstrumentation {
  async install(integration: Telemetry): Promise<void> {
    // `@ai-sdk/harness` is ESM-only and this package ships CommonJS: a dynamic import is the one
    // form both module systems accept.
    const { HarnessAgent } = await import('@ai-sdk/harness/agent');
    instrumentHarnessAgentClass(HarnessAgent, integration);
  }
}
