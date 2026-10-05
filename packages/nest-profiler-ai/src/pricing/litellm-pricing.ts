import type { AiModelPricing, AiPricingTable } from '../ai-pricing';

const LITELLM_PRICES_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

/** Options for {@link fetchLiteLLMPricing}. */
export interface LiteLLMPricingOptions {
  /** Overrides the endpoint — a pinned commit, a mirror, a fixture in tests. */
  url?: string;
  /** Overrides the fetch implementation, for tests or for a proxied network. */
  fetch?: typeof globalThis.fetch;
  /** ms before the request is abandoned. Default: `10000`. */
  timeout?: number;
}

/** LiteLLM quotes every rate in USD per token, as a number. */
function rate(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toPricing(raw: unknown): AiModelPricing | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const source = raw as Record<string, unknown>;

  const input = rate(source['input_cost_per_token']);
  const output = rate(source['output_cost_per_token']);
  if (input === undefined || output === undefined) return undefined;

  const cacheRead = rate(source['cache_read_input_token_cost']);
  const cacheWrite = rate(source['cache_creation_input_token_cost']);
  const reasoning = rate(source['output_cost_per_reasoning_token']);
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
 * Reads the prices LiteLLM keeps for every model of every provider — the public list `ccusage`
 * costs Claude Code sessions with — ready to hand to `pricingSource`. It needs no key:
 *
 * ```ts
 * AiCollectorModule.forRoot({ pricingSource: () => fetchLiteLLMPricing() });
 * ```
 *
 * Model ids come back as LiteLLM writes them: bare for a provider's own API
 * (`claude-sonnet-4-5`, `gpt-4o-mini`), which is what the AI SDK and Claude Code report, and
 * prefixed for a reseller (`bedrock/…`, `vertex_ai/…`).
 */
export async function fetchLiteLLMPricing(
  options: LiteLLMPricingOptions = {},
): Promise<AiPricingTable> {
  const impl = options.fetch ?? globalThis.fetch;
  const response = await impl(options.url ?? LITELLM_PRICES_URL, {
    signal: AbortSignal.timeout(options.timeout ?? 10_000),
  });
  if (!response.ok) throw new Error(`LiteLLM pricing: HTTP ${response.status}`);

  const payload: unknown = await response.json();
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('LiteLLM pricing: unexpected payload');
  }

  const table: AiPricingTable = {};
  for (const [id, model] of Object.entries(payload)) {
    // The file documents its own schema under this key, with every rate set to zero.
    if (id === 'sample_spec') continue;
    const pricing = toPricing(model);
    if (pricing) table[id] = pricing;
  }
  return table;
}
