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

`@eleven-labs/nest-profiler-ai` records every [AI SDK](https://ai-sdk.dev) call made during a profiled execution — `generateText`, `streamText`, `generateObject`, the agents built on top of them, and the tools the SDK runs between them — and displays them in an **AI** panel.

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

- the **agent** that ran it, when one did (see [Agents](#agents))
- the **model** and provider, and the sampling settings the call was made with
- the **system prompt**, kept apart from the conversation
- the **tools declared**, each tagged `local` (declared in your code), `mcp` (discovered on an MCP server at runtime) or `provider` (built into the model, like a hosted web search), with the JSON Schema the model had to fill
- every **step** in order — token usage, cost, finish reason, time to first token, throughput, the messages sent, the model's reasoning, the completion and the tool calls it asked for
- each **tool execution** interleaved where it happened, with its input, output and duration
- **structured output** beside the schema it had to satisfy, **attachments** as their media type and size or URL (never the bytes), and any **human approval** with its decision

Model calls and tool executions also land on the execution trace, so the model's share of a request is visible against everything else it did.

## Agents

An AI SDK [`Agent`](https://ai-sdk.dev/docs/reference/ai-sdk-core/agent) — `ToolLoopAgent`, and everything built on it such as [`createAgentUIStream`](https://ai-sdk.dev/docs/reference/ai-sdk-core/create-agent-ui-stream), `createAgentUIStreamResponse` and `pipeAgentUIStreamToResponse` — runs its loop through `generateText` / `streamText`, so its calls, steps and tool executions are recorded like any other, streamed answers included.

Give your agent the `id` the SDK already offers, and every entry it produces is named after it:

```ts title="support.agent.ts"
import { ToolLoopAgent } from 'ai';

export const supportAgent = new ToolLoopAgent({ id: 'support', model, instructions, tools });
```

That is the whole integration — this file imports nothing from the profiler. The panel badges each section with the agent that ran it, the trace labels its spans with it, and the AI list gains an **Agent** filter beside the **Model** one, so a support agent and a summarizer are no longer two identical-looking loops.

It works because the module instruments the `ToolLoopAgent` class once at startup, the same bargain `registerTelemetry` makes: the SDK drops an agent's `id` before any telemetry event carries it, so the class is asked instead. The wrapper only reads `id` and opens an async frame around the call — no argument, result or error changes, and agents built before startup are covered too.

An agent with no `id` is still recognised as an agent run, just an anonymous one: the SDK tags every request an agent makes with an `ai-sdk-agent/tool-loop` user-agent, which the collector reads.

Agents nest — an agent called from inside another's tool is attributed to the one that made the call.

### Naming what the class cannot name

`profileAgent` is the escape hatch, for the two cases the class instrumentation cannot reach: an agent that implements the `Agent` interface itself rather than extending `ToolLoopAgent`, and an agent whose panel name should differ from its `id`.

```ts
import { profileAgent } from '@eleven-labs/nest-profiler-ai';

const support = profileAgent(myCustomAgent, { id: 'support', name: 'Support agent' });
```

The wrapper is the same agent to every caller — same `id`, same `tools`, same results — so it can be provided in place of the original and handed to the SDK's own helpers unchanged. When both apply, the wrapper's name wins.

> Unlike the `id` route, this puts an import of this package in application code, so the file that calls it cannot be part of an app that keeps the profiler in [`devDependencies` only](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#devdependency-only-the-dev-entry-split).

## The AI list

A profiled request that called a model is promoted to its own `ai` entrypoint kind — the same promotion GraphQL operations get. Those profiles then have a dedicated list with the models used, the operation and step count, the tools run, the tokens, the model time and the cost, plus a `Model` filter. They keep the Request and Response tabs, since they are still HTTP requests.

Set `entrypoint: false` to leave them among the plain HTTP requests; the panel is unaffected either way.

## Streamed answers

A streaming handler returns long before the transport stops writing. `@eleven-labs/nest-profiler` measures such a response until its last chunk, which is what lets the model call made _during_ the stream reach this panel at all — and the Response tab then reports the delivery: time to first chunk, how long the stream ran, chunks and bytes.

That holds whatever the handler streams: raw tokens through `pipeTextStreamToResponse`, a NestJS `@Sse()` observable, or an agent's UI message stream through `pipeAgentUIStreamToResponse` / `createAgentUIStreamResponse`. The profiler measures what the transport wrote, not how the handler produced it.

## Options

| Option              | Default      | Description                                                                                                        |
| ------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `enabled`           | `true`       | Register the collector at all                                                                                      |
| `capture`           | `'redacted'` | How much of what was said is stored (see [Prompts, secrets and personal data](#prompts-secrets-and-personal-data)) |
| `redaction`         | —            | What the `redacted` level masks, on top of the built-in detectors                                                  |
| `maxTextLength`     | `2000`       | Characters kept of any one captured text                                                                           |
| `maxMessages`       | `40`         | Messages kept per call, counted from the most recent                                                               |
| `pricing`           | —            | Token prices by model, so calls are costed (see [Cost](#cost))                                                     |
| `pricingSource`     | —            | Loads those prices from an API or a database, once at startup, cached                                              |
| `pricingTtl`        | `0`          | ms before a loaded price table is reloaded in the background                                                       |
| `entrypoint`        | `true`       | Promote a request that called a model to the `ai` kind, with its own list                                          |
| `error`             | HTTP         | What counts as a failed AI request, for the `ai` kind                                                              |
| `slowThreshold`     | `5000`       | A model call at or above this duration (ms) is tagged `slow`                                                       |
| `nPlusOneThreshold` | `3`          | This many identical calls or more are tagged `n-plus-one`                                                          |
| `chattyThreshold`   | `5`          | At or above this many calls in one profile, the profile is tagged `chatty`                                         |

## Prompts, secrets and personal data

A prompt is not a SQL query. It carries whatever the application put in front of the model: the user's own words, the documents retrieved for them, the record a tool just read, the key another tool was handed. The completion, the model's reasoning, the tool arguments and the structured output carry the same things back. All of it would otherwise be written to a profile that outlives the request, is readable in the dashboard and is exported by `/_profiler/:token/data`.

So the collector **masks content by default**. `capture` decides how much reaches a stored profile:

| Level        | What is stored                                                                                |
| ------------ | --------------------------------------------------------------------------------------------- |
| `'none'`     | No content at all. The figures stay: model, tokens, cost, timings, tool names, finish reasons |
| `'metadata'` | The shape only — `[text omitted · 1842 chars]`, `[object omitted · keys: query, limit]`       |
| `'redacted'` | **Default.** The content, with credentials and personal data masked                           |
| `'full'`     | Verbatim, masking off. A local machine, not a shared environment                              |

```ts
AiCollectorModule.forRoot({ capture: 'redacted' });
```

One level covers everything, or set them field by field — the conversation is usually the sensitive part, not the completion, and a tool that reads a customer record is not its arguments:

```ts
AiCollectorModule.forRoot({
  capture: {
    default: 'redacted',
    messages: 'metadata', // the user's own words never leave the process
    reasoning: 'none', // a thinking model restates the whole prompt to itself
    toolResults: 'metadata', // the tools read production data; their arguments are harmless
  },
});
```

| Field             | What it covers                                                              |
| ----------------- | --------------------------------------------------------------------------- |
| `instructions`    | The system prompt, which the SDK keeps apart from the conversation          |
| `messages`        | The conversation sent to the model                                          |
| `completion`      | The model's answer                                                          |
| `reasoning`       | The model's thinking, when it exposed any                                   |
| `toolDefinitions` | The tools declared to the model: descriptions and input schemas             |
| `toolArguments`   | What a tool was called with, and the reason of an approval on it            |
| `toolResults`     | What a tool answered                                                        |
| `output`          | `generateObject`'s parsed object and the schema it had to satisfy           |
| `runtimeContext`  | The context the application threads through the run — **opt-in**, see below |

Two shorthands set several at once: `prompt` covers `instructions` and `messages`, `tools` covers the three tool fields. A field named on its own always wins over its group, and a group over `default`:

```ts
capture: { default: 'full', prompt: 'redacted', tools: 'metadata', toolResults: 'none' }
```

A tool payload is captured under its own field wherever it turns up, including inside the conversation — the messages carry the same arguments and results back to the model, and `tools: 'none'` means it there too.

The panel says which level a profile was taken at, so a completion that was never recorded is never mistaken for a model that answered nothing, and the module logs a warning at startup when anything is set to `'full'`.

### The runtime context is opt-in

An application threads its own state through a generation: the AI SDK's `runtimeContext` on the call, and each tool's `toolContext` on its execution — the user, the tenant, the token a tool needs to reach your own API. It is the one thing here that is not what was said, so no blanket level pulls it in, not even `capture: 'full'`. It is recorded only when `runtimeContext` names it:

```ts
AiCollectorModule.forRoot({
  capture: { default: 'redacted', runtimeContext: 'redacted' }, // tenant kept, token masked
});
```

The call's context then shows with the generation, and each tool's own beside its input and output.

### What `redacted` masks

The same detectors the rest of the profiler uses on request bodies, so an AI payload is protected by the same rules: object keys that name a secret (`password`, `apiKey`, `authorization`, `token`, …) and values that look like one — JWTs, `sk-`/`pk-` keys, PEM private-key blocks, `scheme://user:pass@` userinfo, Luhn-valid card numbers. On top of those, the personal-data shapes a prompt is full of: email addresses, international phone numbers, IBANs, US social-security numbers.

An attachment's URL goes through the query-string masking a captured request URL gets, so a signed URL keeps its address and loses its signature. A provider error or warning is masked too, and never dropped — a provider quotes the offending prompt back at you.

Masking runs over the whole text before it is truncated, so a credential cannot survive by straddling the cut.

### Extending it

```ts
AiCollectorModule.forRoot({
  redaction: {
    keys: ['patientId', 'ssn'], // extra object keys whose value is masked
    patterns: [/CUST-\d{6}/g], // extra value shapes, masked inside any text
    replacement: '***', // default '[REDACTED]'
    pii: false, // stop masking emails, phone numbers, IBANs
    useDefaults: false, // drop the built-in key list — deliberate and total
  },
});
```

Detection is best-effort: a name, a street or a national id in a local format goes through. Where the data is regulated, `metadata` or `none` is the answer rather than a longer pattern list — or your own scrubber, which runs over every text that is kept, after the built-in masking:

```ts
AiCollectorModule.forRoot({
  redaction: {
    sanitize: (text, { field, role, tool }) =>
      field === 'toolResults' && tool === 'readPatientRecord' ? '[REDACTED]' : presidio.scrub(text),
  },
});
```

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

A provider that answers as another model prices under the id the call asked for: OpenAI resolves `gpt-4o-mini` to the dated snapshot `gpt-4o-mini-2024-07-18`, and a table keyed on the models your application knows about still costs that call. The snapshot is what the panel shows, since it is what ran, and a price set on the snapshot itself wins over the one asked for.

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

Tools borrowed from a Model Context Protocol server arrive as ordinary AI SDK tools, so they are captured like any other — and labelled `mcp` in the panel without the application declaring anything:

```ts
import { createMCPClient } from '@ai-sdk/mcp';

const client = await createMCPClient({ transport: { type: 'http', url } });
const tools = await client.tools(); // already recognised as `mcp`
```

The tool objects the client builds carry marks a local `tool()` never has, and the AI SDK hands the whole tool set over when an operation starts — which is the last point at which a tool still says where it came from, since the provider only ever sees names and schemas. The collector reads it there, per operation, so a local tool that happens to share a name with a remote one is not mislabelled.

If you build your MCP tools yourself rather than through `@ai-sdk/mcp`'s client, declare their names instead:

```ts
import { markMcpTools } from '@eleven-labs/nest-profiler-ai';

markMcpTools(Object.keys(tools));
```

> That import lives in application code, so the file that calls it cannot be part of an app that keeps the profiler in [`devDependencies` only](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#devdependency-only-the-dev-entry-split). The automatic path has no such constraint.

## Documentation

Full documentation: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-ai>

## License

MIT
