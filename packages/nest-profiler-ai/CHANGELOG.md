# @eleven-labs/nest-profiler-ai

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
