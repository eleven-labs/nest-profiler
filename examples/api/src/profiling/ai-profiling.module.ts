import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiCollectorModule } from '@eleven-labs/nest-profiler-ai';
import type { AiCaptureOptions, AiPricingSource } from '@eleven-labs/nest-profiler-ai';
import { HarnessInstrumentation } from '@eleven-labs/nest-profiler-ai/harness';
import { fetchLiteLLMPricing, fetchOpenRouterPricing } from '@eleven-labs/nest-profiler-ai/pricing';
import type { AiConfig } from '../config/ai.config.js';
import { HTTP_ERROR_OPTIONS } from './error-classification.js';

/** A bare level covers the opt-in fields too — the runtime context and the raw provider bodies. */
const withOptInFields = (capture: AiCaptureOptions): AiCaptureOptions =>
  typeof capture === 'string'
    ? { default: capture, runtimeContext: capture, providerPayload: capture }
    : capture;

const PRICING_SOURCES: Record<string, AiPricingSource> = {
  openrouter: () => fetchOpenRouterPricing(),
  litellm: () => fetchLiteLLMPricing(),
};

/**
 * The **AI** panel, for both contexts that call a model: the OpenRouter assistant (`FEATURE_AI`)
 * and the coding agent (`FEATURE_AI_HARNESS`). Registered once at the composition root when either
 * is on, since the collector is process-wide — neither context knows it exists.
 *
 * `HarnessInstrumentation` brings the coding agent's `HarnessAgent` turns in. It comes from its own
 * subpath, so an application that does not use `@ai-sdk/harness` leaves it out and never loads it.
 */
@Module({
  imports: [
    AiCollectorModule.forRootAsync({
      instrumentations: [HarnessInstrumentation],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const ai = config.get<AiConfig>('ai');
        const pricingSource = PRICING_SOURCES[ai?.pricing ?? ''];
        return {
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
          capture: withOptInFields(ai?.capture ?? 'full'),
          // OpenRouter reports what each call cost, so prices are only needed for the providers
          // that do not — Claude Code and Codex report tokens only. `AI_PRICING=openrouter` prices
          // OpenRouter's model ids, `AI_PRICING=litellm` the ids a provider's own API uses.
          ...(pricingSource !== undefined && { pricingSource, pricingTtl: 24 * 60 * 60 * 1000 }),
        };
      },
    }),
  ],
})
export class AiProfilingModule {}
