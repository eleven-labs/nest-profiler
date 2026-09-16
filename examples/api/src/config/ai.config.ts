import { registerAs } from '@nestjs/config';

/** Free OpenRouter model that streams reliably and supports tools; override with `AI_MODEL`. */
const DEFAULT_MODEL = 'liquid/lfm-2.5-2.6b:free';

export default registerAs('ai', () => ({
  apiKey: process.env['OPENROUTER_API_KEY'] ?? '',
  model: process.env['AI_MODEL'] ?? DEFAULT_MODEL,
  // Room for a small free model to finish a structured answer: below ~512 it truncates its JSON
  // mid-object and `generateObject` fails to parse it.
  maxOutputTokens: parseInt(process.env['AI_MAX_OUTPUT_TOKENS'] ?? '512', 10),
  temperature: parseFloat(process.env['AI_TEMPERATURE'] ?? '0.7'),
  // Free models are best-effort: some queue for minutes or never answer. Without a cap a demo
  // request would hang until the client gives up.
  timeoutMs: parseInt(process.env['AI_TIMEOUT_MS'] ?? '30000', 10),
  // How hard the model should think before answering, when it supports a reasoning phase.
  reasoning: process.env['AI_REASONING'] ?? 'provider-default',
  // Model Context Protocol server whose tools are merged into the assistant's. Empty: no MCP.
  mcpUrl: process.env['AI_MCP_URL'] ?? '',
  // `openrouter` prices every model from OpenRouter's public list, so a call is costed even when
  // the provider reports no cost. Off by default: it is one HTTP call at startup.
  pricing: process.env['AI_PRICING'] ?? '',
  // Sent to OpenRouter as the calling app, which is how it attributes free-tier usage.
  appUrl: process.env['AI_APP_URL'] ?? 'https://nest-profiler.eleven-labs.com',
  appTitle: process.env['AI_APP_TITLE'] ?? 'nest-profiler example API',
}));

export interface AiConfig {
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  temperature: number;
  timeoutMs: number;
  reasoning: string;
  mcpUrl: string;
  pricing: string;
  appUrl: string;
  appTitle: string;
}
