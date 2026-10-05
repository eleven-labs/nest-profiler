import { Module } from '@nestjs/common';
import { CodingAgentController } from './coding-agent.controller.js';
import { codingAgentProvider } from './coding-agent.provider.js';

/**
 * Coding-agent context — Claude Code or Codex driven through the AI SDK's `HarnessAgent`, on this
 * machine. Gated by `FEATURE_AI_HARNESS` at the composition root.
 *
 * Nothing here knows the profiler exists: `AiProfilingModule` installs `HarnessInstrumentation`,
 * which profiles every `HarnessAgent` from the `id` it declares.
 */
@Module({
  controllers: [CodingAgentController],
  providers: [codingAgentProvider],
})
export class CodingAgentModule {}
