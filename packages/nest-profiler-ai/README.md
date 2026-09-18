# @eleven-labs/nest-profiler-ai

<p align="center">
  <a href="https://eleven-labs.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/assets/eleven-labs-white.svg">
      <img alt="Powered &amp; maintained by Eleven Labs" src="https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/assets/eleven-labs-dark.svg" width="180">
    </picture>
  </a>
</p>

<p align="center"><em>Powered &amp; maintained by <a href="https://eleven-labs.com">Eleven Labs</a></em></p>

<p align="center">
  <a href="https://github.com/eleven-labs/nest-profiler/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/eleven-labs/nest-profiler/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/eleven-labs/nest-profiler/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/eleven-labs/nest-profiler/actions/workflows/quality.yml/badge.svg" /></a>
  <a href="https://codecov.io/gh/eleven-labs/nest-profiler/flags"><img alt="Coverage" src="https://codecov.io/gh/eleven-labs/nest-profiler/branch/main/graph/badge.svg?flag=nest-profiler-ai" /></a>
  <a href="https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-ai"><img alt="Documentation" src="https://img.shields.io/badge/docs-nest--profiler.eleven--labs.com-e5225a" /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a" />
  <img alt="Built with NestJS" src="https://img.shields.io/badge/built%20with-NestJS-ea2845" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Code style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" />
</p>

> **Alpha.** This package is published under the `alpha` dist-tag while its API settles, so
> `pnpm add @eleven-labs/nest-profiler-ai` will not pick it up — ask for it explicitly:
> `pnpm add @eleven-labs/nest-profiler-ai@alpha`. Expect breaking changes before `1.0.0`.

`@eleven-labs/nest-profiler-ai` records every [AI SDK](https://ai-sdk.dev) call made during a profiled execution — `generateText`, `streamText`, `generateObject`, and the tools the SDK runs between them — and displays them in an **AI** panel.

Nothing in the application changes: no model is wrapped and no call site is touched. The module registers one AI SDK telemetry integration at startup, and every call made while a request is being profiled lands in that request's profile.

## Installation

```bash
pnpm add @eleven-labs/nest-profiler-ai
```

**Peer dependencies:** `ai ^7.0.0`

## Setup

```ts title="app.module.ts"
import { ConditionalModule } from '@nestjs/config';
import { AiCollectorModule } from '@eleven-labs/nest-profiler-ai';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] === 'true';

@Module({
  imports: [ConditionalModule.registerWhen(AiCollectorModule.forRoot(), isProfilerEnabled)],
})
export class AppModule {}
```

That is the whole integration. Your services keep calling the AI SDK exactly as they did.

## What the panel shows

One section per `generateText` / `streamText` / `generateObject` invocation:

- the **model** and provider, and the sampling settings the call was made with
- the **system prompt**, kept apart from the conversation
- the **tools declared**, each tagged `local` (declared in your code), `mcp` (discovered on an MCP server at runtime) or `provider` (built into the model, like a hosted web search), with the JSON Schema the model had to fill
- every **step** in order — token usage, cost, finish reason, time to first token, throughput, the messages sent, the model's reasoning, the completion and the tool calls it asked for
- each **tool execution** interleaved where it happened, with its input, output and duration
- **structured output** beside the schema it had to satisfy, **attachments** as their media type and size or URL (never the bytes), and any **human approval** with its decision

Model calls and tool executions also land on the execution trace, so the model's share of a request is visible against everything else it did.

## The AI list

A profiled request that called a model is promoted to its own `ai` entrypoint kind — the same promotion GraphQL operations get. Those profiles then have a dedicated list with the models used, the operation and step count, the tools run, the tokens, the model time and the cost, plus a `Model` filter. They keep the Request and Response tabs, since they are still HTTP requests.

Set `entrypoint: false` to leave them among the plain HTTP requests; the panel is unaffected either way.

## Streamed answers

A streaming handler returns long before the transport stops writing. `@eleven-labs/nest-profiler` measures such a response until its last chunk, which is what lets the model call made _during_ the stream reach this panel at all — and the Response tab then reports the delivery: time to first chunk, how long the stream ran, chunks and bytes.

## Options

| Option              | Default | Description                                                                |
| ------------------- | ------- | -------------------------------------------------------------------------- |
| `enabled`           | `true`  | Register the collector at all                                              |
| `captureContent`    | `true`  | Record prompts, messages, completions, reasoning and tool payloads         |
| `maxTextLength`     | `2000`  | Characters kept of any one captured text                                   |
| `maxMessages`       | `40`    | Messages kept per call, counted from the most recent                       |
| `pricing`           | —       | Token prices by model, so calls are costed (see [Cost](#cost))             |
| `pricingSource`     | —       | Loads those prices from an API or a database, once at startup, cached      |
| `pricingTtl`        | `0`     | ms before a loaded price table is reloaded in the background               |
| `entrypoint`        | `true`  | Promote a request that called a model to the `ai` kind, with its own list  |
| `error`             | HTTP    | What counts as a failed AI request, for the `ai` kind                      |
| `slowThreshold`     | `5000`  | A model call at or above this duration (ms) is tagged `slow`               |
| `nPlusOneThreshold` | `3`     | This many identical calls or more are tagged `n-plus-one`                  |
| `chattyThreshold`   | `5`     | At or above this many calls in one profile, the profile is tagged `chatty` |

### Prompts that must not be stored

Where prompts carry personal or regulated data, turn the content off and keep the figures:

```ts
AiCollectorModule.forRoot({ captureContent: false });
```

The panel then still reports the model, token usage, cost, timings, finish reasons and tool names — everything you profile for — and records none of what was said.

## Cost

Most providers bill you but report nothing back, so the panel has only the token counts to go on. Give it the prices and it works the cost out itself, per call and per request:

```ts
AiCollectorModule.forRoot({
  pricing: {
    'openai:gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075 },
    'anthropic:claude-sonnet-4': { input: 3, output: 15 },
  },
});
```

Rates are USD per million tokens, the unit providers publish. A key is `provider:model` or the bare model id, matched in that order, so one entry can cover a model served by several providers. `cacheRead`, `cacheWrite` and `reasoning` are optional and fall back to `input` or `output`; cached and thinking tokens are already counted in the totals, so each is billed once, at its own rate.

When the prices are not yours to hardcode — they change, or your application already keeps them — load them instead:

```ts
import { fetchOpenRouterPricing } from '@eleven-labs/nest-profiler-ai';

AiCollectorModule.forRoot({
  pricingSource: () => fetchOpenRouterPricing(), // every model OpenRouter serves
  pricingTtl: 24 * 60 * 60 * 1000, // re-read once a day; omit to load once
});
```

`pricingSource` is any function returning a table, so it reads a database just as well:

```ts
AiCollectorModule.forRootAsync({
  inject: [ModelRepository],
  useFactory: (models: ModelRepository) => ({
    pricingSource: async () =>
      Object.fromEntries(
        (await models.findAll()).map((m) => [m.id, { input: m.inputPrice, output: m.outputPrice }]),
      ),
  }),
});
```

It is called when the module starts and, once `pricingTtl` has passed, again in the background — never on the path of a model call, which never waits for it. A source that fails leaves the costs unknown and is not asked again until the TTL expires.

A figure the provider reports itself always wins: OpenRouter files one under `openrouter.usage.cost`, and that is what you will be invoiced. A cost worked out from prices is marked `est.` in the panel. A model nobody priced shows **unknown**, with a note that prices are configurable — never `free`, and never a guess. Unknown and free are not the same thing, and the panel will not pretend otherwise.

## MCP tools

Tools borrowed from a Model Context Protocol server arrive as ordinary AI SDK tools, so they are captured like any other. Tell the collector which names came from a server and it labels them `mcp` in the panel:

```ts
import { markMcpTools } from '@eleven-labs/nest-profiler-ai';

const tools = await mcpClient.tools();
markMcpTools(Object.keys(tools));
```

## Documentation

Full documentation: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-ai>

## License

MIT
