# @eleven-labs/nest-profiler-pubsub

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
  <a href="https://codecov.io/gh/eleven-labs/nest-profiler/flags"><img alt="Coverage" src="https://codecov.io/gh/eleven-labs/nest-profiler/branch/main/graph/badge.svg?flag=nest-profiler-pubsub" /></a>
  <a href="https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-pubsub"><img alt="Documentation" src="https://img.shields.io/badge/docs-nest--profiler.eleven--labs.com-e5225a" /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a" />
  <img alt="Built with NestJS" src="https://img.shields.io/badge/built%20with-NestJS-ea2845" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Code style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" />
</p>

`@eleven-labs/nest-profiler-pubsub` brings Google Cloud Pub/Sub (`@google-cloud/pubsub`) into the profiler: `PubSubPublishCollectorModule` lists every message published during a profiled request in a **Pub/Sub** panel, with its topic, attributes, ordering key, payload, server-assigned message id, duration and outcome.

## Installation

```bash
pnpm add -D @eleven-labs/nest-profiler-pubsub
```

**Peer dependencies:** `@google-cloud/pubsub` 5 or 6 (the client you already use to talk to Pub/Sub, which stays a regular dependency of your app) and `nestjs-cls`, already installed with the core.

## Publishing messages — `PubSubPublishCollectorModule`

Register it in the dev-only profiling bundle. Your `PubSub` client and your topics stay in your own application module:

```ts title="profiling/profiling.module.ts"
import { Module } from '@nestjs/common';
import { ProfilerModule } from '@eleven-labs/nest-profiler';
import { PubSubPublishCollectorModule } from '@eleven-labs/nest-profiler-pubsub';

@Module({
  imports: [ProfilerModule.forRoot({ isGlobal: true }), PubSubPublishCollectorModule.forRoot()],
})
export class ProfilingModule {}
```

> `ProfilingModule` is the dev-only bundle loaded by `main-dev.ts` — see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#recommended-install-it-as-a-dev-dependency). If the profiler is installed as a production dependency behind the [runtime gate](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#when-production-code-calls-the-profiler-conditionalmodule), wrap the same call in `ConditionalModule.registerWhen(..., isProfilerEnabled)`.

Your publishers need no changes — `publishMessage`, `publishJSON` and the deprecated `publish` are all captured, with a promise or a callback:

```ts
await this.pubSub.topic('orders').publishMessage({
  json: order,
  attributes: { eventType: 'order.created' },
});
```

### Configuration

```ts
PubSubPublishCollectorModule.forRoot({
  captureAttributes: true, // default — message attributes (sensitive ones masked)
  captureBody: true, // default — the published message
  maskAttributes: ['x-tenant-secret'], // merged with the built-in mask list
  payloadLimits: { maxStringLength: 512 }, // depth / size caps on the captured payload
  slowThreshold: 100, // default — a publish at or above this duration is tagged `slow`
  nPlusOneThreshold: 5, // default — publishes to one topic repeated this many times are tagged N+1
  chattyThreshold: 10, // default — a request publishing this many messages is tagged `chatty`
  // What counts as a failed publish. The default is "publishMessage() failed".
  error: { classify: (entry) => (entry.error?.includes('CANCELLED') ? false : undefined) },
});
```

Use `forRootAsync` to resolve any of these from `ConfigService`. Behind the runtime gate, wrap it in the same `ConditionalModule.registerWhen(..., isProfilerEnabled)` to keep the panel out of production.

The thresholds are higher than RabbitMQ's on purpose: a Pub/Sub publish waits for its batch to be sent and for a round-trip to the Google API, and the client batches the messages published in a row, so a few publishes to the same topic are idiomatic rather than an N+1.

### What it collects

One entry per publish, listed in the **Pub/Sub** panel:

| Field         | Description                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `topic`       | Short id of the topic (`orders`)                                                                 |
| `projectId`   | Google Cloud project of the topic, when the client knew it at publish time                       |
| `payload`     | The published message — `json`, or `data` decoded as JSON or text — redacted and size-capped     |
| `size`        | Size of the published data, in bytes                                                             |
| `attributes`  | Message attributes, sensitive ones masked (when `captureAttributes`)                             |
| `orderingKey` | Ordering key, when the publisher set one                                                         |
| `messageId`   | Server-assigned message id, once Pub/Sub acknowledged the publish                                |
| `duration`    | Time until `publishMessage()` settled — includes the time the message waited in the client batch |
| `error`       | The message `publishMessage()` failed with, when it failed                                       |

Entries are tagged by the core rule engine: `slow`, `n-plus-one`, `chatty` and `error`. Each row carries a copy button with a runnable `pubsub.topic(…).publishMessage(…)` snippet that re-publishes the message.

### How it works

The module patches `Topic.prototype.publishMessage` and records every call made while a profile is active — reading the profile from the profiler's CLS context, so a publish outside a profiled request (at bootstrap, from a cron job) records nothing. Patching the prototype covers every topic and every `PubSub` client the application creates, plus `topic.publish()` and `topic.publishJSON()`, which the client routes through `publishMessage`.

The profile is resolved when `publishMessage()` is **called**, not when it settles: the client settles a whole batch from the async context of its first message, so a later lookup could file a message under a concurrent request.

An entry is recorded once the publish settles. A publish the request does not await and that settles after the profile was saved is therefore missing from the panel — await your publishes (or `topic.flush()`) to see them.
