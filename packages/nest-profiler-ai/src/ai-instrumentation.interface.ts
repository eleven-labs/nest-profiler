import type { Telemetry } from 'ai';

/**
 * An optional integration for an agent implementation the AI SDK core does not ship — selected by
 * importing it from its subpath and listing it in `AiCollectorModule.forRoot({ instrumentations })`:
 *
 * ```ts
 * import { HarnessInstrumentation } from '@eleven-labs/nest-profiler-ai/harness';
 *
 * AiCollectorModule.forRoot({ instrumentations: [HarnessInstrumentation] });
 * ```
 *
 * Implementations are NestJS providers, so they may inject what they need through their
 * constructor.
 */
export interface AiInstrumentation {
  /**
   * Teach the integration to report to the profiler. Called once at startup, after the
   * collector has registered `integration` with the AI SDK. A failure is logged, never thrown at
   * the application.
   */
  install(integration: Telemetry): void | Promise<void>;
}
