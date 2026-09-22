import { Inject, Logger, Module, Optional } from '@nestjs/common';
import type { DynamicModule, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ProfilerCoreService, buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import { AiCollector } from './ai.collector';
import { buildAiEntrypointType } from './ai-entrypoint';
import { AiProfilerTelemetry, configureAiEntrypointPromotion } from './ai-telemetry';
import { instrumentAgentClass } from './ai-agent';
import { aiCaptureLevels, configureAiCapture, resetAiCapture } from './ai-capture';
import { configureAiPricing, loadAiPricing } from './ai-pricing';
import {
  AI_COLLECTOR_OPTIONS,
  ConfigurableModuleClass,
  type AiCollectorModuleAsyncOptions,
  type AiCollectorModuleOptions,
} from './ai-collector.interface';

export type {
  AiCollectorModuleOptions,
  AiCollectorModuleAsyncOptions,
} from './ai-collector.interface';

const SHAPE: CollectorModuleShape = { providers: [AiCollector] };

/**
 * `registerTelemetry` adds to a process-wide list, so registering twice records every call twice.
 * A second application instance in the same process (a test harness, a hot reload) must not.
 */
let telemetryRegistered = false;

/**
 * Captures every AI SDK call — `generateText`, `streamText`, `generateObject`, and the tools the
 * SDK runs between them — into the active profile, and renders them as the **AI** panel.
 *
 * Nothing in the application changes: no model is wrapped and no call site is touched. The module
 * registers one AI SDK telemetry integration at startup, and every call made while a request is
 * being profiled lands in that request's profile. Agents are covered on the same terms — a
 * `ToolLoopAgent` is named in its profiles from the `id` the SDK already asks for.
 */
@Module({})
export class AiCollectorModule extends ConfigurableModuleClass implements OnModuleInit {
  constructor(
    private readonly moduleRef: ModuleRef,
    // @Optional() so the module does not throw when forRoot({ enabled: false }) omits providers
    @Optional() private readonly collector?: AiCollector,
    @Optional()
    @Inject(AI_COLLECTOR_OPTIONS)
    private readonly options: AiCollectorModuleOptions = {},
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    if (!this.collector) return;

    // Reset first: the capture configuration is process-wide, so a second application instance
    // in the same process (a test harness, a hot reload) must not inherit the first one's.
    resetAiCapture();
    configureAiCapture({
      ...(this.options.capture !== undefined && { capture: this.options.capture }),
      ...(this.options.captureContent !== undefined && {
        captureContent: this.options.captureContent,
      }),
      ...(this.options.redaction !== undefined && { redaction: this.options.redaction }),
      ...(this.options.maxTextLength !== undefined && {
        maxTextLength: this.options.maxTextLength,
      }),
      ...(this.options.maxMessages !== undefined && { maxMessages: this.options.maxMessages }),
    });
    this.warnOnVerbatimCapture();

    configureAiPricing({
      ...(this.options.pricing !== undefined && { table: this.options.pricing }),
      ...(this.options.pricingSource !== undefined && { source: this.options.pricingSource }),
      ...(this.options.pricingTtl !== undefined && { ttl: this.options.pricingTtl }),
    });
    // Loaded here rather than on the first call, so the first call is already priced and no
    // request ever waits for a price list. A source that is down leaves the costs unknown.
    void loadAiPricing();

    const promote = this.options.entrypoint !== false;
    configureAiEntrypointPromotion(promote);

    if (promote) {
      try {
        // strict: false searches the global scope so ProfilerCoreService is found even when
        // ProfilerModule is imported as a sibling rather than a parent.
        const core = this.moduleRef.get<ProfilerCoreService>(ProfilerCoreService, {
          strict: false,
        });
        core.registerEntrypointType(buildAiEntrypointType(this.options.error));
      } catch {
        // ProfilerCoreService unavailable — the profiler may not be configured.
      }
    }

    if (telemetryRegistered) return;
    telemetryRegistered = true;
    // `ai` is ESM-only and this package ships CommonJS, where a static import compiles to a
    // `require()` Node refuses for an ES module. A dynamic import is the one form both module
    // systems accept — and it keeps `ai` unloaded entirely when the collector is disabled.
    const { registerTelemetry, ToolLoopAgent } = await import('ai');
    registerTelemetry(new AiProfilerTelemetry());
    // The same bargain, for the one thing telemetry cannot report: the SDK drops an agent's `id`
    // before any event carries it, so the class itself is asked instead. Nothing at a call site
    // changes, which is what lets an application keep this package out of production.
    instrumentAgentClass(ToolLoopAgent);
  }

  /**
   * `capture: 'full'` stores prompts, completions and tool payloads exactly as they were, and a
   * profile outlives the request it describes. Saying so once at startup is what keeps it from
   * being an accident nobody notices until the profiles are read.
   */
  private warnOnVerbatimCapture(): void {
    const fields = Object.entries(aiCaptureLevels())
      .filter(([, level]) => level === 'full')
      .map(([field]) => field);
    if (fields.length === 0) return;
    new Logger(AiCollectorModule.name).warn(
      `AI content capture is set to 'full' (${fields.join(', ')}): prompts, completions and tool payloads are stored verbatim, with no masking. Use 'redacted' anywhere the profiles are readable by others.`,
    );
  }

  static forRoot(options: AiCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, SHAPE);
  }

  /**
   * Async variant — resolve the options (whether to record prompt content, say) from DI such as
   * `ConfigService`. Gating stays the host's job via `ConditionalModule.registerWhen`.
   */
  static forRootAsync(options: AiCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, SHAPE);
  }
}
