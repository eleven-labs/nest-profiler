import { ConfigService } from '@nestjs/config';
import type { Provider } from '@nestjs/common';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';
import { LANGUAGE_MODEL } from '../../domain/assistant.js';

/**
 * The single OpenRouter model the assistant talks to, built from `ai.*` config.
 *
 * `usage: { include: true }` turns on OpenRouter's usage accounting, which is what puts the token
 * counts and the per-call cost in `providerMetadata` — and therefore in the profiler's AI panel.
 * Nothing here knows about the profiler: the telemetry integration observes the SDK, not the model.
 */
export const languageModelProvider: Provider = {
  provide: LANGUAGE_MODEL,
  inject: [ConfigService],
  useFactory: (config: ConfigService): LanguageModel => {
    const apiKey = config.getOrThrow<string>('ai.apiKey');
    if (apiKey === '') {
      throw new Error('OPENROUTER_API_KEY is required when FEATURE_AI=true.');
    }
    const openrouter = createOpenRouter({
      apiKey,
      compatibility: 'strict',
      appName: config.getOrThrow<string>('ai.appTitle'),
      appUrl: config.getOrThrow<string>('ai.appUrl'),
    });
    return openrouter.chat(config.getOrThrow<string>('ai.model'), { usage: { include: true } });
  },
};
