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

`@eleven-labs/nest-profiler-rabbitmq` brings RabbitMQ (`@golevelup/nestjs-rabbitmq`) into the profiler, in both directions:

- **Messages you consume** — `RabbitMqCollectorModule` turns every `@RabbitSubscribe` delivery into its own profile: a dedicated **RabbitMQ** view on the profiler home and a built-in **Message** detail tab.
- **Messages you publish** — `RabbitMqPublishCollectorModule` lists every `AmqpConnection.publish` made during a profiled request in a **RabbitMQ** panel, with its exchange, routing key, headers, payload, duration and outcome.

The two are independent: register the one that matches what your application does, or both when it does both.

`RabbitMqCollectorModule` also contributes the **Discover / RabbitMQ** view: the topology the application declared (connections, exchanges, queues, exchange bindings) followed by every consumer with its full subscription — see [The Discover / RabbitMQ view](#the-discover--rabbitmq-view).

![RabbitMQ view — consumed messages with delivery, exchange, routing-key and handler filters](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/rabbitmq-list.png)

![Message detail tab — a consumed review.created delivery with exchange, routing key, handler, delivery metadata and JSON payload](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/rabbitmq.png)

## Installation

```bash
pnpm add @eleven-labs/nest-profiler-rabbitmq@alpha
```

> There is no stable release yet — install every `@eleven-labs/nest-profiler*` package with the `@alpha` dist-tag (`@latest` resolves to nothing).

**Peer dependencies:** `@golevelup/nestjs-rabbitmq` and `amqplib` (the ones you already use to talk to the broker). They are optional — when no RabbitMQ traffic runs, the modules simply never produce a profile or a panel entry.

## Consuming messages — `RabbitMqCollectorModule`

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

### Configuration

```ts
RabbitMqCollectorModule.forRoot({
  captureHeaders: true, // default — RabbitMQ headers (sensitive ones masked)
  captureBody: true, // default — deserialized payload (can be large)
  maskHeaders: ['x-tenant-secret'], // merged with the built-in mask list
  // What counts as a failed message. A message has no status code, so the default is
  // simply "the handler threw" — narrow it when a handler throws as flow control.
  error: { exceptions: ['TimeoutError'] },
});
```

`error` decides what earns the `error` tag and what the list's **Errors** filter keeps. See [What counts as an error](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/error-classification). Use `forRootAsync` to resolve any of these from `ConfigService`.

> **Enabling / disabling** — gate the collector with `ConditionalModule.registerWhen(..., isProfilerEnabled)` as shown, so it loads only when `PROFILER_ENABLED` is on. Wire the core `ProfilerModule` **once at the root** — the recommended setup bundles the root-level profiler modules into a single `ProfilingModule` behind a `ConditionalModule` gate (see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#enabling-and-disabling-the-profiler) and the [example app](https://nest-profiler.eleven-labs.com/docs/example-api)). A top-level `enabled` option is also supported as an alternative.

### What it collects

Each consumed message becomes a profile with a `rabbitmq` entrypoint (`entrypoint.type = 'rabbitmq'`, with this payload on `entrypoint.data`):

| Field         | Description                                      |
| ------------- | ------------------------------------------------ |
| `exchange`    | Exchange the message was published to            |
| `routingKey`  | Routing key the message was published with       |
| `handler`     | `Class.method` of the `@RabbitSubscribe` handler |
| `redelivered` | `true` when the broker redelivered the message   |
| `consumerTag` | RabbitMQ consumer tag                            |
| `deliveryTag` | RabbitMQ delivery tag                            |
| `messageId`   | `messageId` message property, when set           |
| `appId`       | `appId` message property, when set               |

The masked headers and the payload are stored on `entrypoint.data.headers` / `entrypoint.data.payload`.

### How it works

A consumed message has no HTTP request/response, so the module registers an `IContextAdapter` for the `rmq` execution context that **creates** a fresh profile per message. The core `ProfilerInterceptor` wraps the handler in a CLS context — so profile-scoped collectors (HTTP client, database, …) keep capturing — then persists the profile. The module registers the `rabbitmq` entrypoint type, so the profiler renders it in a dedicated **RabbitMQ** sidebar view and a built-in **Message** detail tab; the HTTP Request/Response tabs are hidden, exactly like CLI commands.

## Publishing messages — `RabbitMqPublishCollectorModule`

Register it wherever the profiler runs — a publish-only API needs nothing else from this package:

```ts title="app.module.ts"
import { ConditionalModule } from '@nestjs/config';
import { RabbitMqPublishCollectorModule } from '@eleven-labs/nest-profiler-rabbitmq';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] === 'true';

@Module({
  imports: [
    ConditionalModule.registerWhen(RabbitMqPublishCollectorModule.forRoot(), isProfilerEnabled),
    // your RabbitMQModule.forRoot(...)
  ],
})
export class AppModule {}
```

Your publishers need no changes — keep injecting `AmqpConnection`:

```ts
await this.amqp.publish('articles.events', event.name, event.payload);
```

### Configuration

```ts
RabbitMqPublishCollectorModule.forRoot({
  captureHeaders: true, // default — publish headers (sensitive ones masked)
  captureBody: true, // default — the published message
  maskHeaders: ['x-tenant-secret'], // merged with the built-in mask list
  payloadLimits: { maxStringLength: 512 }, // depth / size caps on the captured payload
  slowThreshold: 50, // default — a publish at or above this duration is tagged `slow`
  nPlusOneThreshold: 2, // default — identical publishes repeated this many times are tagged N+1
  chattyThreshold: 10, // default — a request publishing this many messages is tagged `chatty`
});
```

Use `forRootAsync` to resolve any of these from `ConfigService`, and the same
`ConditionalModule.registerWhen(..., isProfilerEnabled)` gate as above to keep the panel out of
production.

### What it collects

One entry per publish, listed in the **RabbitMQ** panel:

| Field                       | Description                                                               |
| --------------------------- | ------------------------------------------------------------------------- |
| `exchange` / `routingKey`   | Where the message was sent (`(default)` for the default exchange)         |
| `payload`                   | The published message, redacted and size-capped (when `captureBody`)      |
| `headers`                   | Publish headers, sensitive ones masked (when `captureHeaders`)            |
| `messageId` / `appId`       | message properties, when the publisher set them                           |
| `correlationId` / `replyTo` | message properties of an RPC call                                         |
| `duration`                  | Time spent in `publish()`                                                 |
| `accepted`                  | `false` when the channel buffered the message (its write buffer was full) |
| `error`                     | The message `publish()` rejected with, when it failed                     |

Entries are tagged by the core rule engine: `slow`, `n-plus-one` (the same message published once
per loop iteration) and `error`. Each row carries a copy button with a runnable amqplib
`channel.publish(...)` snippet that re-emits the message.

### How it works

The module patches `AmqpConnection.prototype.publish` and records every call made while a profile
is active — reading the profile from the profiler's CLS context, so a publish outside a profiled
request (at bootstrap, from a cron job) records nothing. Patching the prototype covers every
connection the application registers, plus the publishes golevelup itself routes through
`publish`: `AmqpConnection.request()` for RPC calls and the reply an `@RabbitRPC` handler sends.

Because the panel is profile-scoped, it works under any entrypoint — an HTTP request, a CLI
command, or a consumed message when `RabbitMqCollectorModule` is registered too, which is how you
see the messages a consumer republishes.

Only the caller's publish options are captured, not the connection's `defaultPublishOptions`.

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)

## The Discover / RabbitMQ view

Registering `RabbitMqCollectorModule` alongside
[`@eleven-labs/nest-profiler-routes`](https://github.com/eleven-labs/nest-profiler/tree/main/packages/nest-profiler-routes)
adds a **Discover / RabbitMQ** view listing what the application declared at startup. Everything is
read from the resolved `RabbitMQModule` configuration — no management-API call, no extra
credentials, and the view stays accurate while the broker is down.

**The topology**, as sections above the handler list:

| Section           | What it lists                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| Connections       | Every declared connection with its broker URI (credentials masked), prefetch, channels and handler configs |
| Exchanges         | Each exchange with its type, durability flags and arguments                                                |
| Queues            | Each queue with the binding that feeds it (`← exchange (routing keys)`), its flags and its `x-…` arguments |
| Exchange bindings | Each `exchangeBindings` entry with its pattern                                                             |

The queues nothing subscribes to — dead-letter, retry, delay — are listed too: they carry the flow
even though no handler names them.

**The handlers**, one entry per registration golevelup performs. Expanding one shows the whole
subscription rather than just its `exchange → routingKey` locator:

| Group         | What it lists                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| Subscription  | `queue`, `exchange`, `routingKey`, the `connection` it runs on, its module-level `handler config` and `channel` |
| Bindings      | Each `bindings: [{ exchange, routingKey }]` pair, when the handler binds across exchanges                       |
| Queue options | The `queueOptions` it asserts, with `arguments` spread one `x-…` key per row                                    |
| Behaviour     | `allowNonJsonMessages`, `errorBehavior`, `batchOptions`, a custom `deserializer`, …                             |

Two golevelup behaviours the view makes visible: a handler with no `connection` is registered on
**every** declared connection — listed once per connection, which is the multi-vhost trap that
asserts a queue on the wrong vhost — and a handler whose `name` matches no entry in that
connection's `handlers` map is **not registered** at all, which the entry says in place of its
description.
