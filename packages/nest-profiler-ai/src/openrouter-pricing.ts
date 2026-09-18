import type { AiModelPricing, AiPricingTable } from './ai-pricing';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/** Options for {@link fetchOpenRouterPricing}. */
export interface OpenRouterPricingOptions {
  /** Overrides the endpoint — a mirror, a gateway, a fixture in tests. */
  url?: string;
  /** Sent as `Authorization: Bearer …`. The public model list needs no key. */
  apiKey?: string;
  /** Overrides the fetch implementation, for tests or for a proxied network. */
  fetch?: typeof globalThis.fetch;
  /** ms before the request is abandoned. Default: `10000`. */
  timeout?: number;
}

/** OpenRouter quotes every rate in USD per token, as a string. */
function rate(value: unknown): number | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toPricing(raw: unknown): AiModelPricing | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const pricing = (raw as { pricing?: unknown }).pricing;
  if (typeof pricing !== 'object' || pricing === null) return undefined;
  const source = pricing as Record<string, unknown>;

  const input = rate(source['prompt']);
  const output = rate(source['completion']);
  if (input === undefined || output === undefined) return undefined;

  const cacheRead = rate(source['input_cache_read']);
  const cacheWrite = rate(source['input_cache_write']);
  const reasoning = rate(source['internal_reasoning']);
  return {
    input,
    output,
    ...(cacheRead !== undefined && { cacheRead }),
    ...(cacheWrite !== undefined && { cacheWrite }),
    ...(reasoning !== undefined && { reasoning }),
    per: 1,
  };
}

/**
 * Reads the prices of every model OpenRouter serves, ready to hand to `pricingSource`. The list
 * is public, so no key is needed, and it is fetched once when the module starts:
 *
 * ```ts
 * AiCollectorModule.forRoot({ pricingSource: () => fetchOpenRouterPricing() });
 * ```
 *
 * Model ids come back as OpenRouter writes them (`openai/gpt-4o-mini`), which is what the AI SDK
 * reports when the call went through OpenRouter. Price a model called through its own provider
 * with a `pricing` entry instead.
 */
export async function fetchOpenRouterPricing(
  options: OpenRouterPricingOptions = {},
): Promise<AiPricingTable> {
  const impl = options.fetch ?? globalThis.fetch;
  const response = await impl(options.url ?? OPENROUTER_MODELS_URL, {
    signal: AbortSignal.timeout(options.timeout ?? 10_000),
    headers: options.apiKey !== undefined ? { authorization: `Bearer ${options.apiKey}` } : {},
  });
  if (!response.ok) throw new Error(`OpenRouter pricing: HTTP ${response.status}`);

  const payload: unknown = await response.json();
  const models = (payload as { data?: unknown }).data;
  if (!Array.isArray(models)) throw new Error('OpenRouter pricing: unexpected payload');

  const table: AiPricingTable = {};
  for (const model of models) {
    const id = (model as { id?: unknown }).id;
    if (typeof id !== 'string' || id === '') continue;
    const pricing = toPricing(model);
    if (pricing) table[id] = pricing;
  }
  return table;
}
