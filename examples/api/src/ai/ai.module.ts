import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigService } from '@nestjs/config';
import { AiCollectorModule, fetchOpenRouterPricing } from '@eleven-labs/nest-profiler-ai';
import type { AiCaptureOptions } from '@eleven-labs/nest-profiler-ai';
import { isProfilerEnabled } from '../config/profiler.config.js';
import type { AiConfig } from '../config/ai.config.js';
import { HTTP_ERROR_OPTIONS } from '../profiling/error-classification.js';
import { AssistantController } from './http/assistant.controller.js';
import { AssistantService } from './application/assistant.service.js';
import { AssistantTools } from './application/assistant.tools.js';
import { ApprovalStore } from './application/approval.store.js';
import { languageModelProvider } from './infrastructure/openrouter/language-model.provider.js';
import { McpToolsProvider } from './infrastructure/mcp/mcp-tools.provider.js';

/** A bare level covers the opt-in fields too — the runtime context and the raw provider bodies. */
const withOptInFields = (capture: AiCaptureOptions): AiCaptureOptions =>
  typeof capture === 'string'
    ? { default: capture, runtimeContext: capture, providerPayload: capture }
    : capture;

/**
 * AI bounded context — an OpenRouter-backed assistant exposed several ways: one blocking answer,
 * a tool loop, structured output, an attachment, a human approval, and two streamed ones. Gated by
 * `FEATURE_AI` at the composition root, because it needs an `OPENROUTER_API_KEY` and is not part of
 * the Vercel deployment.
 *
 * `AiCollectorModule` is what fills the **AI** panel. Nothing else here knows the profiler exists.
 */
@Module({
  imports: [
    ConditionalModule.registerWhen(
      AiCollectorModule.forRootAsync({
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          error: HTTP_ERROR_OPTIONS,
          // A demo shows the prompts, so it asks for `full` — everything here is made up. An
          // application with real users leaves this out and keeps the masked default, or sets
          // `AI_CAPTURE=metadata`/`none` to store less still, down to one field at a time
          // (`AI_CAPTURE=default:redacted,prompt:metadata,toolResults:none`).
          //
          // A bare level opts the runtime context and the provider payload in along with it,
          // which the collector never does on its own: the assistant threads a tenant through
          // every generation, and the demo is here to show it and the bodies OpenRouter exchanged.
          // Name `runtimeContext` or `providerPayload` explicitly to decide otherwise.
          capture: withOptInFields(config.get<AiConfig>('ai')?.capture ?? 'full'),
          // OpenRouter reports what each call cost, so prices are only needed for the providers
          // that do not — set `AI_PRICING=openrouter` to price every model from its public list.
          ...(config.get<AiConfig>('ai')?.pricing === 'openrouter' && {
            pricingSource: () => fetchOpenRouterPricing(),
            pricingTtl: 24 * 60 * 60 * 1000,
          }),
        }),
      }),
      isProfilerEnabled,
    ),
  ],
  controllers: [AssistantController],
  providers: [
    languageModelProvider,
    AssistantService,
    AssistantTools,
    ApprovalStore,
    McpToolsProvider,
  ],
})
export class AiModule {}
