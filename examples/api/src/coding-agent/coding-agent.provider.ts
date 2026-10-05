import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HarnessAgent } from '@ai-sdk/harness/agent';
import { createClaudeCode } from '@ai-sdk/harness-claude-code';
import { createCodex } from '@ai-sdk/harness-codex';
import type { AiHarnessConfig } from '../config/ai-harness.config.js';

const INSTRUCTIONS =
  'You work in a scratch directory of a NestJS profiler demo. Keep every change inside it. ' +
  'When you are done, answer with a short summary: the files you changed and how you checked them.';

/**
 * Claude Code or Codex, driven through the AI SDK's `HarnessAgent`. Its `id` is all the profiler
 * needs to name it in every profile — nothing here imports the profiler.
 */
export const codingAgentProvider: Provider = {
  provide: HarnessAgent,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const { runtime, apiKey, model } = config.getOrThrow<AiHarnessConfig>('aiHarness');
    // `direct`: the CLI's own login. Otherwise the key, under the variable the runtime reads.
    const auth =
      apiKey === ''
        ? 'direct'
        : { [runtime === 'codex' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY']: apiKey };
    return new HarnessAgent({
      id: 'coding-agent',
      harness: runtime === 'codex' ? createCodex({ auth }) : createClaudeCode({ auth }),
      ...(model !== '' && { model }),
      instructions: INSTRUCTIONS,
      // Nothing waits on a human here: a command needing approval would end the turn unanswered.
      // The runtime therefore runs whatever it decides to, with this process's permissions.
      permissionMode: 'allow-all',
    });
  },
};
