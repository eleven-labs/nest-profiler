import { registerAs } from '@nestjs/config';
import type { AiCaptureLevel, AiCaptureOptions } from '@eleven-labs/nest-profiler-ai';

const CAPTURE_LEVELS: readonly string[] = ['none', 'metadata', 'redacted', 'full'];

const isLevel = (value: string): value is AiCaptureLevel => CAPTURE_LEVELS.includes(value);

/**
 * `AI_CAPTURE` as the collector takes it: one level for everything (`full`), or a level per field
 * and per group (`default:redacted,prompt:metadata,toolResults:none`).
 *
 * The collector's own contract is what is being demonstrated here — an application with one
 * policy writes the level and never needs the second form.
 */
function parseCapture(raw: string): AiCaptureOptions {
  if (!raw.includes(':')) return isLevel(raw) ? raw : 'redacted';
  const levels: Record<string, AiCaptureLevel> = {};
  for (const pair of raw.split(',')) {
    const [field, level] = pair.split(':').map((part) => part.trim());
    if (field !== undefined && level !== undefined && isLevel(level)) levels[field] = level;
  }
  return levels;
}

/** Free OpenRouter model that streams reliably and supports tools; override with `AI_MODEL`. */
const DEFAULT_MODEL = 'liquid/lfm-2.5-2.6b:free';

export default registerAs('ai', () => ({
  apiKey: process.env['OPENROUTER_API_KEY'] ?? '',
  model: process.env['AI_MODEL'] ?? DEFAULT_MODEL,
  // Room for a small free model to finish a structured answer: below ~512 it truncates its JSON
  // mid-object and the structured output fails to parse.
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
  // How much of what was said reaches a stored profile: none | metadata | redacted | full, or a
  // level per field. The collector's own default is `redacted`; this demo shows the prompts as
  // they were sent, which is the point of the panel and is only safe because nothing here is
  // real data.
  capture: parseCapture(process.env['AI_CAPTURE'] ?? 'full'),
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
  capture: AiCaptureOptions;
  appUrl: string;
  appTitle: string;
}
