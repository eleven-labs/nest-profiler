import { registerAs } from '@nestjs/config';

export default registerAs('aiHarness', () => {
  // The coding-agent runtime the `HarnessAgent` drives: `claude-code` or `codex`.
  const runtime = process.env['AI_HARNESS'] === 'codex' ? 'codex' : 'claude-code';
  return {
    runtime,
    // An Anthropic key for Claude Code, an OpenAI key for Codex. Empty: the login the runtime's own
    // CLI already holds on this machine (`claude login`, `codex login`).
    apiKey: process.env['AI_HARNESS_API_KEY'] ?? '',
    // Claude Code reports the model it ran only when one is set, and the profile prices a call by
    // it: Haiku keeps a demo turn quick and cheap. Codex: its own default (it reports none).
    model: process.env['AI_HARNESS_MODEL'] ?? (runtime === 'claude-code' ? 'claude-haiku-4-5' : ''),
  };
});

export interface AiHarnessConfig {
  runtime: 'claude-code' | 'codex';
  apiKey: string;
  model: string;
}
