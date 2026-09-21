import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';
import type {
  CollectorModuleOptions,
  ProfilerErrorOptions,
  TagSeverityOptions,
} from '@eleven-labs/nest-profiler';
import type { AiPricingSource, AiPricingTable } from './ai-pricing';
import type { AiCaptureOptions, AiRedactionOptions } from './ai-capture';

export interface AiCollectorModuleOptions extends CollectorModuleOptions, TagSeverityOptions {
  /**
   * How much of what was said reaches a stored profile — the system prompt, the conversation,
   * the completion, the model's reasoning, tool payloads and structured output. Default:
   * `'redacted'`.
   *
   * A prompt carries whatever the application put in front of the model: the user's own words,
   * the documents retrieved for them, the credentials a tool was handed. So the default records
   * the content with credentials and personal data masked, and the levels below take it further
   * in either direction:
   *
   * - `'none'` — no content at all; the figures (model, tokens, cost, timings, tool names) stay.
   * - `'metadata'` — the shape only: how long a text was, which keys a payload had.
   * - `'redacted'` — the content, masked (**default**). See {@link AiCollectorModuleOptions.redaction}.
   * - `'full'` — verbatim, masking off. A local machine, not a shared environment.
   *
   * One level applies to everything, or set them field by field — `instructions`, `messages`,
   * `completion`, `reasoning`, `toolDefinitions`, `toolArguments`, `toolResults`, `output` — with
   * `prompt` and `tools` as shorthands for the fields under them:
   *
   * ```ts
   * capture: { default: 'redacted', prompt: 'metadata', toolResults: 'none' }
   * ```
   *
   * `runtimeContext` (the AI SDK's `toolContext`: the user, the tenant, a token a tool needs) is
   * the exception — it is the application's own state rather than what was said, so no blanket
   * level pulls it in and it is recorded only when named.
   */
  capture?: AiCaptureOptions;
  /**
   * @deprecated Use {@link AiCollectorModuleOptions.capture}: `true` means `'redacted'` and
   * `false` means `'none'`. Ignored when `capture` is set.
   */
  captureContent?: boolean;
  /**
   * What the `redacted` level masks, on top of the built-in credential detectors it shares with
   * the rest of the profiler — extra object keys, extra value patterns, personal-data shapes, or
   * your own scrubber.
   */
  redaction?: AiRedactionOptions;
  /** Characters kept of any one captured text before it is truncated. Default: `2000`. */
  maxTextLength?: number;
  /** Messages kept per call, counted from the most recent. Default: `40`. */
  maxMessages?: number;
  /**
   * Promote a profiled HTTP request that called a model to its own `ai` entrypoint kind, which
   * gives those profiles their own list with the models, tokens and cost. Default: `true`.
   *
   * Turn it off to leave them among the HTTP requests — the AI panel is unaffected either way.
   */
  entrypoint?: boolean;
  /**
   * Token prices by model, so a call is costed even though its provider reports no cost — which
   * most do not. Keys are `provider:model` or the bare model id:
   *
   * ```ts
   * pricing: { 'openai:gpt-4o-mini': { input: 0.15, output: 0.6 } }
   * ```
   *
   * Prices are per million tokens unless the entry says otherwise, and a figure the provider
   * reports itself always wins over one worked out here.
   */
  pricing?: AiPricingTable;
  /**
   * Where to load prices from when they are not yours to hardcode — a pricing API, the table
   * your own application already keeps. Called once when the module starts, off the path of any
   * request, and its result is cached; {@link AiCollectorModuleOptions.pricingTtl} reloads it.
   *
   * ```ts
   * pricingSource: () => fetchOpenRouterPricing(),
   * ```
   *
   * Entries from {@link AiCollectorModuleOptions.pricing} take precedence over loaded ones.
   */
  pricingSource?: AiPricingSource;
  /**
   * ms before the loaded table is reloaded, in the background. Default: `0` — loaded once at
   * startup, which is all a price list that changes monthly needs.
   */
  pricingTtl?: number;
  /**
   * What counts as a **failed** AI request, for the `ai` entrypoint kind. Defaults to the HTTP
   * rule (5xx), since an AI request is still served over HTTP.
   */
  error?: ProfilerErrorOptions;
  /**
   * A model call at or above this duration (ms) is tagged `slow`. Default: `5000` — a model
   * answers on a scale of seconds, not the milliseconds a query is judged on.
   */
  slowThreshold?: number;
  /** This many identical calls or more are tagged `n-plus-one`. Default: `3`. */
  nPlusOneThreshold?: number;
  /** At or above this many calls in one profile, the profile is tagged `chatty`. Default: `5`. */
  chattyThreshold?: number;
}

/** Async configuration for `AiCollectorModule.forRootAsync`. */
export type AiCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<AiCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
  };

/** DI token holding the resolved {@link AiCollectorModuleOptions}. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: AI_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<AiCollectorModuleOptions>().setClassMethodName('forRoot').build();
