# @eleven-labs/nest-profiler-event-emitter

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
  <a href="https://codecov.io/gh/eleven-labs/nest-profiler/flags"><img alt="Coverage" src="https://codecov.io/gh/eleven-labs/nest-profiler/branch/main/graph/badge.svg?flag=nest-profiler-event-emitter" /></a>
  <a href="https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-event-emitter"><img alt="Documentation" src="https://img.shields.io/badge/docs-nest--profiler.eleven--labs.com-e5225a" /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a" />
  <img alt="Built with NestJS" src="https://img.shields.io/badge/built%20with-NestJS-ea2845" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Code style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" />
</p>

`@eleven-labs/nest-profiler-event-emitter` captures the domain events an application dispatches through `@nestjs/event-emitter`. Every emission shows up in an **Events** panel on the profile that published it, every `@OnEvent` subscription is listed in the **Routes** panel, and — by default — each handler execution becomes a profile of its own, so the work an event triggers stops being invisible.

## Installation

```bash
pnpm add @eleven-labs/nest-profiler-event-emitter@alpha @nestjs/event-emitter
```

> There is no stable release yet — install every `@eleven-labs/nest-profiler*` package with the `@alpha` dist-tag (`@latest` resolves to nothing).

**Peer dependencies:** `@nestjs/event-emitter ^3.0.0`, `nestjs-cls ^6.0.0`

## Setup

```ts title="app.module.ts"
import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventEmitterCollectorModule } from '@eleven-labs/nest-profiler-event-emitter';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] === 'true';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ConditionalModule.registerWhen(EventEmitterCollectorModule.forRoot(), isProfilerEnabled),
  ],
})
export class AppModule {}
```

> **Enabling / disabling** — gate the collector with `ConditionalModule.registerWhen(..., isProfilerEnabled)` as shown, so it loads only when `PROFILER_ENABLED` is on. Wire the core `ProfilerModule` **once at the root** — the recommended setup bundles the root-level profiler modules into a single `ProfilingModule` behind a `ConditionalModule` gate (see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#enabling-and-disabling-the-profiler) and the [example app](https://nest-profiler.eleven-labs.com/docs/example-api)). A top-level `enabled` option is also supported as an alternative.

Place the collector wherever `EventEmitterModule` is registered — it is infra-scoped, like the cache and messaging collectors, not a root-level panel.

## What it collects

### 1. The Events panel — what a profile emitted

One row per `emit` / `emitAsync` call made during the profiled execution:

| Field           | Description                                                                |
| --------------- | -------------------------------------------------------------------------- |
| `event`         | Emitted event name (a namespaced array is joined with dots)                |
| `payload`       | Redacted and size-bounded emitted value; `undefined` when capture is off   |
| `listenerCount` | Listeners subscribed at emit time — `0` is highlighted as a likely mistake |
| `duration`      | Synchronous dispatch for `emit`; every awaited handler for `emitAsync`     |
| `async`         | `true` when emitted through `emitAsync`                                    |
| `startedAt`     | Unix timestamp                                                             |
| `error`         | Message of an error thrown by `emit` or rejected by an awaited handler     |

Entries feed the core performance-rule engine under the `event` tag domain, so a slow emission is tagged `slow`, a repeated one `n-plus-one`, and a request emitting a lot of them `chatty` — with the thresholds below.

### 2. The `event` entrypoint — what a listener did

Unless `profileListeners: false`, every `@OnEvent` execution gets its **own profile**, carrying the logs, SQL queries and outgoing HTTP calls that ran inside the handler. They render in a dedicated **Events** list table (`?view=event`), with **Status** and **Event** filters and an **Event** detail tab showing the handler, the received payload and any error.

### 3. The Routes panel — what subscribes to what

An **Event Listeners** group lists every `@OnEvent` subscription discovered across providers and controllers, as `ON <event> → <Provider>.<method>()`.

## Options

| Option              | Default   | Description                                                                            |
| ------------------- | --------- | -------------------------------------------------------------------------------------- |
| `enabled`           | `true`    | Build-time switch; `false` registers no provider at all                                |
| `capturePayload`    | `true`    | Capture the (redacted) emitted value — turn off when payloads may hold PII             |
| `maxPayloadLength`  | `2000`    | Max length of the stringified payload kept per event                                   |
| `ignoreEvents`      | `[]`      | Event names never recorded; strings match exactly, RegExps are tested against the name |
| `emitterToken`      | —         | DI token of the `EventEmitter2` to patch, when it is not the default class             |
| `profileListeners`  | `true`    | Give each `@OnEvent` execution its own profile                                         |
| `slowThreshold`     | `100`     | An emission at or above this duration (ms) is tagged `slow`                            |
| `nPlusOneThreshold` | `2`       | This many identical event names or more tags the profile `n-plus-one`                  |
| `chattyThreshold`   | `20`      | At or above this many emissions, the profile is tagged `chatty`                        |
| `slowSeverity`      | `warning` | Severity of the `slow` tag                                                             |
| `error`             | —         | What counts as a failed handler execution (`ProfilerErrorOptions`)                     |

`newListener` and `removeListener` — EventEmitter2's own subscription bookkeeping — are always ignored.

## Toolbar badge

The number of events emitted during the execution (e.g. `3`), hidden when none. The tab turns amber or red when the emissions carry `slow` / `error` tags.

## How it works

At module initialization the collector resolves the app's `EventEmitter2` through `ModuleRef` and wraps its `emit` and `emitAsync`. The active `Profile` is read **synchronously at emit entry**, the one point where the request's `nestjs-cls` context is guaranteed active; `emitAsync` is then timed out-of-band by observing the returned promise, so the caller still gets it untouched. Both methods are restored on shutdown.

For listener profiling, the collector scans the DI container at bootstrap for `@OnEvent` methods and replaces each one on its owning instance with a wrapper that opens a fresh CLS branch, runs the handler, then collects and persists the resulting profile. `@nestjs/event-emitter` resolves `instance[method]` at emit time, so the wrapping takes effect regardless of hook order; the handler's decorator metadata is copied onto the wrapper so the loader still recognises it as a listener.

Everything degrades to a no-op when the profiler core is absent or disabled, and the app boots unchanged when `@nestjs/event-emitter` is not registered.

## Limitations

- **Request-scoped subscribers are not profiled.** `@nestjs/event-emitter` resolves a fresh instance per event through `Injector.loadPerContext`, so there is no stable handler to wrap. They still appear in the Routes panel.
- **`EventEntry.error` is rarely populated.** `@OnEvent` defaults to `suppressErrors: true`, so a throwing handler is logged by `@nestjs/event-emitter` and never surfaces to the emitter. Subscribe with `{ suppressErrors: false }` to see handler failures on the emitting profile — the handler's own `event` profile records the failure either way.

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
