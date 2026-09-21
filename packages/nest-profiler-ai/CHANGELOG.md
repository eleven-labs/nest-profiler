# @eleven-labs/nest-profiler-ai

## 1.0.0-alpha.1

### Major Changes

- cf4be72: BREAKING: prompts, completions, reasoning and tool payloads are now masked before they are stored. Set `capture: 'full'` to record them verbatim as before, and note that `captureContent: true` now reads as `'redacted'` rather than verbatim.

  Mask what an AI call says, by default, and let the host decide how much of it is stored at all.

  A prompt carries whatever the application put in front of the model: the user's own words, the documents retrieved for them, the record a tool just read, the key another tool was handed. The completion, the reasoning, the tool arguments and the structured output carry the same things back — into a profile that outlives the request, is readable in the dashboard and is exported by `/_profiler/:token/data`. Until now all of it was recorded verbatim, and the only alternative was recording none of it.

  `capture` now decides how much reaches a stored profile, per field or in one go: `'none'` keeps the figures and nothing that was said, `'metadata'` keeps the shape (`[text omitted · 1842 chars]`, `[object omitted · keys: query, limit]`), `'redacted'` — the new default — keeps the content with credentials and personal data masked, and `'full'` is the verbatim capture that used to be the only behaviour.

  The fields are `instructions`, `messages`, `completion`, `reasoning`, `toolDefinitions`, `toolArguments`, `toolResults` and `output`, with `prompt` and `tools` as shorthands over them, so a conversation can be reduced to its shape while the completions stay readable, or a tool that reads a customer record be dropped while its arguments stay. A tool payload follows its own field wherever it turns up, including inside the conversation the model was sent. `runtimeContext` is the exception to every default: the state an application threads through a generation (the AI SDK's `runtimeContext` on the call, each tool's `toolContext` on its execution — the user, the tenant, a token) is the application's own, not what was said, so it is recorded only when it is named, not even by `capture: 'full'`. It then shows with the generation and beside each tool execution in the panel.

  Masking reuses the profiler's own detectors, so an AI payload is protected by the same rules as a request body — secret-looking object keys, JWTs, `sk-`/`pk-` keys, PEM blocks, URL userinfo, Luhn-valid card numbers — plus the personal-data shapes a prompt is full of: email addresses, international phone numbers, IBANs, US social-security numbers. It runs before truncation, so a credential cannot survive by straddling the cut. An attachment's URL loses its signature the way a captured request URL does, and a provider error is masked rather than dropped, since a provider quotes the offending prompt back at you. `redaction` extends all of it with extra keys, extra patterns, another replacement sentinel, or a `sanitize` scrubber of the host's own.

  Tool call arguments and tool results were recorded even with `captureContent: false`; they now follow the `toolArguments` and `toolResults` levels like the rest. `captureContent` still works and is deprecated: `true` reads as `'redacted'` and `false` as `'none'`. The level each field was captured at is stored on the profile and shown in the panel, so a completion that was never recorded is not mistaken for a model that answered nothing, and the module logs a warning at startup when anything is set to `'full'`.

### Patch Changes

- cf4be72: Cost a call whose provider answered as another model. OpenAI resolves `gpt-4o-mini` to the dated snapshot `gpt-4o-mini-2024-07-18` and reports the snapshot back, so a price table keyed on the ids an application actually asks for — which is what a registry of models holds — matched nothing, and such a call was filed as `unknown` even though its prices were configured.

  The resolved id remains what the call is recorded and priced as, since it is what ran; only when nothing prices it is the id the call was made with tried, read from the operation the step belongs to. A price set on the snapshot itself therefore still wins over the one asked for, and a cost the provider reported itself wins over both.

## 1.0.0-alpha.0

### Minor Changes

- e0d53f6: First release of the AI SDK collector, on the `alpha` channel. Every [AI SDK](https://ai-sdk.dev) call made while a request is profiled — `generateText`, `streamText`, `generateObject`, and the tools the SDK runs between them — is recorded and shown in an **AI** panel.

  - **Nothing in the application changes.** No model is wrapped and no call site is touched: the module registers one AI SDK telemetry integration at startup, and every call made while a request is being profiled lands in that request's profile.
  - **One section per invocation** — the model and provider, the sampling settings the call was made with, the system prompt kept apart from the conversation, and the tools declared, each tagged `local`, `mcp` or `provider` with the JSON Schema the model had to fill.
  - **Every step in order**, with token usage, cost, finish reason, time to first token, throughput, the messages sent, the model's reasoning, the completion and the tool calls it asked for. Each tool execution is interleaved where it happened, with its input, output and duration.
  - **Structured output** beside the schema it had to satisfy, attachments as their media type and size or URL (never the bytes), and any human approval with its decision.
  - **A dedicated `ai` entrypoint kind**, the promotion GraphQL operations already get: a profiled request that called a model gets its own list — models used, operation and step counts, tools run, tokens, model time and cost, plus a `Model` filter — while keeping its Request and Response tabs. `entrypoint: false` leaves those profiles among the plain HTTP requests.
  - Model calls and tool executions also land on the execution trace, so the model's share of a request is visible against everything else it did.

  Content capture is bounded and opt-out (`captureContent`, `maxTextLength`, `maxMessages`), and calls are costed from a price table you provide inline or load once at startup.

  Requires Node >= 22, NestJS 11, `@eleven-labs/nest-profiler` ^1.0.0 and `ai` ^7.0.0. The package stays on the `alpha` dist-tag while its API settles, so install it explicitly — `pnpm add @eleven-labs/nest-profiler-ai@alpha` — and expect breaking changes before the stable release.

  Documentation: https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-ai
