import type { AiTokenUsage } from './ai-call.interface';

/**
 * What one model charges, in the currency of your choice — the panel prints it with a `$`, so
 * quote USD unless every model you price is quoted in the same other currency.
 *
 * Prices are per {@link AiModelPricing.per} tokens, a million by default, which is how providers
 * publish them. Only `input` and `output` are required: a rate left out falls back to the one it
 * refines, so a model with no cache discount and no separate thinking rate needs just the two.
 */
export interface AiModelPricing {
  /** Fresh input tokens — those the provider did not read from its prompt cache. */
  input: number;
  /** Output tokens, thinking included unless {@link AiModelPricing.reasoning} says otherwise. */
  output: number;
  /** Input tokens read from the prompt cache, usually a fraction of `input`. Default: `input`. */
  cacheRead?: number;
  /** Input tokens written to the prompt cache, usually dearer than `input`. Default: `input`. */
  cacheWrite?: number;
  /** Thinking tokens, when the provider bills them apart. Default: `output`. */
  reasoning?: number;
  /** Tokens the prices above are quoted per. Default: `1000000`. */
  per?: number;
}

/**
 * Prices by model. A key is either `provider:model` (`openai:gpt-4o-mini`) or the bare model id
 * (`gpt-4o-mini`), matched in that order and case-insensitively, so one table can price a model
 * shared by several providers and still fall back to a single rate for the rest.
 */
export type AiPricingTable = Record<string, AiModelPricing>;

/**
 * Loads a price table from wherever the prices live — an HTTP API, a database, a config service.
 * Called once when the module starts and, if `pricingTtl` is set, again when the table goes
 * stale; never on the path of a model call.
 */
export type AiPricingSource = () => AiPricingTable | Promise<AiPricingTable>;

/** How {@link AiCollectorModuleOptions} configures this registry. */
export interface AiPricingConfig {
  table?: AiPricingTable;
  source?: AiPricingSource;
  /** ms before a table loaded from the source is reloaded. `0` loads it once. */
  ttl?: number;
}

const DEFAULT_PER = 1_000_000;

let statics: AiPricingTable = {};
let loaded: AiPricingTable = {};
let source: AiPricingSource | undefined;
let ttl = 0;
let loadedAt = 0;
let loading: Promise<void> | undefined;

function normalise(table: AiPricingTable): AiPricingTable {
  const normalised: AiPricingTable = {};
  for (const [key, value] of Object.entries(table)) normalised[key.toLowerCase()] = value;
  return normalised;
}

/** Replaces the registry's configuration. Called by the module at startup. */
export function configureAiPricing(config: AiPricingConfig): void {
  statics = normalise(config.table ?? {});
  source = config.source;
  ttl = config.ttl ?? 0;
  loaded = {};
  loadedAt = 0;
  loading = undefined;
}

/** Drops everything the registry holds — prices, source and cache. */
export function resetAiPricing(): void {
  configureAiPricing({});
}

async function load(): Promise<void> {
  if (!source) return;
  try {
    loaded = normalise(await source());
  } catch {
    // A price is a nicety: a source that is down must never break a profile, and the next
    // expiry will try again.
    loaded = {};
  }
  loadedAt = Date.now();
  loading = undefined;
}

/** Never loaded, or loaded longer ago than the TTL allows. */
function isStale(): boolean {
  return loadedAt === 0 || (ttl > 0 && Date.now() - loadedAt >= ttl);
}

/**
 * Loads the price table, awaiting it. The module calls this at startup so the very first model
 * call is already priced; nothing on a request's path ever waits for it.
 *
 * A load that failed counts as done until the TTL expires, so a source that is down is asked
 * once, not once per model call.
 */
export async function loadAiPricing(): Promise<void> {
  if (!source) return;
  if (loading === undefined && !isStale()) return;
  loading ??= load();
  await loading;
}

/** Reloads in the background once the table is stale, so no model call ever waits for a source. */
function refreshIfStale(): void {
  if (!source || loading !== undefined || !isStale()) return;
  loading = load();
  void loading;
}

/**
 * The prices for one model. A provider arrives qualified by its transport (`openai.responses`),
 * so its root is tried too, and the bare model id last.
 */
export function pricingFor(provider: string, model: string): AiModelPricing | undefined {
  refreshIfStale();
  const id = model.toLowerCase();
  const full = provider.toLowerCase();
  const root = full.split('.')[0] ?? full;
  for (const key of [`${full}:${id}`, `${root}:${id}`, id]) {
    const price = statics[key] ?? loaded[key];
    if (price) return price;
  }
  return undefined;
}

/**
 * What a call cost, from its token counts and the model's prices. Cached and thinking tokens are
 * billed at their own rate and are already counted in the input and output totals, so they are
 * taken out of those before each rate is applied.
 */
export function estimateCost(
  usage: AiTokenUsage | undefined,
  provider: string,
  model: string,
): number | undefined {
  if (!usage) return undefined;
  const price = pricingFor(provider, model);
  if (!price) return undefined;

  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const reasoning = usage.reasoning ?? 0;
  const fresh = Math.max(0, (usage.input ?? 0) - cacheRead - cacheWrite);
  const text = Math.max(0, (usage.output ?? 0) - reasoning);

  const total =
    fresh * price.input +
    cacheRead * (price.cacheRead ?? price.input) +
    cacheWrite * (price.cacheWrite ?? price.input) +
    text * price.output +
    reasoning * (price.reasoning ?? price.output);

  // Nanodollars: a cheap model on a short prompt costs less than a microdollar.
  return Math.round((total / (price.per ?? DEFAULT_PER)) * 1e9) / 1e9;
}
