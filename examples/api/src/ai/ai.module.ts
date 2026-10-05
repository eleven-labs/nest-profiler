import { Module } from '@nestjs/common';
import { AssistantController } from './http/assistant.controller.js';
import { AssistantService } from './application/assistant.service.js';
import { AssistantTools } from './application/assistant.tools.js';
import { ApprovalStore } from './application/approval.store.js';
import { languageModelProvider } from './infrastructure/openrouter/language-model.provider.js';
import { McpToolsProvider } from './infrastructure/mcp/mcp-tools.provider.js';

/**
 * AI bounded context — an OpenRouter-backed assistant exposed several ways: one blocking answer,
 * a tool loop, structured output, an attachment, a human approval, and two streamed ones. Gated by
 * `FEATURE_AI` at the composition root, because it needs an `OPENROUTER_API_KEY` and is not part of
 * the Vercel deployment.
 *
 * The **AI** panel is filled by `AiProfilingModule`, registered at the composition root. Nothing
 * here knows the profiler exists.
 */
@Module({
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
