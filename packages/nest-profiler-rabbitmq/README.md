# @eleven-labs/nest-profiler-rabbitmq

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
  <a href="https://codecov.io/gh/eleven-labs/nest-profiler/flags"><img alt="Coverage" src="https://codecov.io/gh/eleven-labs/nest-profiler/branch/main/graph/badge.svg?flag=nest-profiler-rabbitmq" /></a>
  <a href="https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-rabbitmq"><img alt="Documentation" src="https://img.shields.io/badge/docs-nest--profiler.eleven--labs.com-e5225a" /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a" />
  <img alt="Built with NestJS" src="https://img.shields.io/badge/built%20with-NestJS-ea2845" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Code style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" />
</p>

`@eleven-labs/nest-profiler-rabbitmq` captures RabbitMQ messages consumed via `@RabbitSubscribe` (`@golevelup/nestjs-rabbitmq`) and surfaces each one as its own profile — a dedicated **RabbitMQ** view on the profiler home and a built-in **Message** detail tab.

![RabbitMQ view — consumed messages with delivery, exchange, routing-key and handler filters](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/rabbitmq-list.png)

![Message detail tab — a consumed review.created delivery with exchange, routing key, handler, delivery metadata and JSON payload](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/rabbitmq.png)

## Installation

```bash
pnpm add @eleven-labs/nest-profiler-rabbitmq@alpha
```

> There is no stable release yet — install every `@eleven-labs/nest-profiler*` package with the `@alpha` dist-tag (`@latest` resolves to nothing).

**Peer dependencies:** `@golevelup/nestjs-rabbitmq` and `amqplib` (the ones you already use to consume messages). They are optional — when no RabbitMQ consumer runs, the module simply never produces a profile.

## Setup

Register the module in the application that consumes your messages (the same process that hosts the profiler), alongside your RabbitMQ module:

```ts title="app.module.ts"
import { ConditionalModule } from '@nestjs/config';
import { RabbitMqCollectorModule } from '@eleven-labs/nest-profiler-rabbitmq';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] === 'true';

@Module({
  imports: [
    ConditionalModule.registerWhen(RabbitMqCollectorModule.forRoot(), isProfilerEnabled),
    // your RabbitMQModule.forRoot(...) with @RabbitSubscribe handlers
  ],
})
export class AppModule {}
```

Your `@RabbitSubscribe` handlers need no changes:

```ts
@RabbitSubscribe({ exchange: 'articles.events', routingKey: 'published.*', queue: 'tts.narration' })
async createGeneration(message: ArticleEvent, raw: ConsumeMessage): Promise<void> {
  // …
}
```

## Configuration

```ts
RabbitMqCollectorModule.forRoot({
  captureHeaders: true, // default — AMQP headers (sensitive ones masked)
  captureBody: true, // default — deserialized payload (can be large)
  maskHeaders: ['x-tenant-secret'], // merged with the built-in mask list
  // What counts as a failed message. A message has no status code, so the default is
  // simply "the handler threw" — narrow it when a handler throws as flow control.
  error: { exceptions: ['TimeoutError'] },
});
```

`error` decides what earns the `error` tag and what the list's **Errors** filter keeps. See [What counts as an error](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/error-classification). Use `forRootAsync` to resolve any of these from `ConfigService`.

> **Enabling / disabling** — gate the collector with `ConditionalModule.registerWhen(..., isProfilerEnabled)` as shown, so it loads only when `PROFILER_ENABLED` is on. Wire the core `ProfilerModule` and its `ProfilerNoopModule` fallback **once at the root** — the recommended setup bundles the root-level profiler modules into a single `ProfilingModule` behind two `ConditionalModule` gates (see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#enabling-and-disabling-the-profiler) and the [example app](https://nest-profiler.eleven-labs.com/docs/example-api)). A top-level `enabled` option is also supported as an alternative.

## What it collects

Each consumed message becomes a profile with a `rabbitmq` entrypoint (`entrypoint.type = 'rabbitmq'`, with this payload on `entrypoint.data`):

| Field         | Description                                      |
| ------------- | ------------------------------------------------ |
| `exchange`    | Exchange the message was published to            |
| `routingKey`  | Routing key the message was published with       |
| `handler`     | `Class.method` of the `@RabbitSubscribe` handler |
| `redelivered` | `true` when the broker redelivered the message   |
| `consumerTag` | AMQP consumer tag                                |
| `deliveryTag` | AMQP delivery tag                                |
| `messageId`   | `messageId` AMQP property, when set              |
| `appId`       | `appId` AMQP property, when set                  |

The masked headers and the payload are stored on `entrypoint.data.headers` / `entrypoint.data.payload`.

## How it works

A consumed message has no HTTP request/response, so the module registers an `IContextAdapter` for the `rmq` execution context that **creates** a fresh profile per message. The core `ProfilerInterceptor` wraps the handler in a CLS context — so profile-scoped collectors (HTTP client, database, …) keep capturing — then persists the profile. The module registers the `rabbitmq` entrypoint type, so the profiler renders it in a dedicated **RabbitMQ** sidebar view and a built-in **Message** detail tab; the HTTP Request/Response tabs are hidden, exactly like CLI commands.

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
