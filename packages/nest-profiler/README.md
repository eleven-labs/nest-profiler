# @eleven-labs/nest-profiler

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
  <a href="https://codecov.io/gh/eleven-labs/nest-profiler/flags"><img alt="Coverage" src="https://codecov.io/gh/eleven-labs/nest-profiler/branch/main/graph/badge.svg?flag=nest-profiler" /></a>
  <a href="https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler"><img alt="Documentation" src="https://img.shields.io/badge/docs-nest--profiler.eleven--labs.com-e5225a" /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a" />
  <img alt="Built with NestJS" src="https://img.shields.io/badge/built%20with-NestJS-ea2845" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Code style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" />
</p>

`@eleven-labs/nest-profiler` provides execution profiling for NestJS applications. Each profiled execution receives a unique token, and the collected data (request, response, performance, logs, exceptions, custom collectors) can be inspected at `/_profiler/{token}`.

![Profiler UI — profiles list with filters, HTTP statuses, durations and global panels](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/profiles-list.png)

## Installation

```bash
pnpm add @eleven-labs/nest-profiler nestjs-cls
```

`nestjs-cls` is a required peer dependency used for per-execution context propagation.

## Quick start

The recommended way to wire the profiler is to gate it with Nest's `ConditionalModule.registerWhen` and pair it with `ProfilerNoopModule`, so it loads only when you want it and `ProfilerService` stays injectable either way:

```ts title="app.module.ts"
import { Module } from '@nestjs/common';
import { ProfilerModule, ProfilerNoopModule } from '@eleven-labs/nest-profiler';
import { ConditionalModule } from '@nestjs/config';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] === 'true';

@Module({
  imports: [
    ConditionalModule.registerWhen(
      ProfilerModule.forRoot({ isGlobal: true, maxProfiles: 100 }),
      isProfilerEnabled,
    ),
    ConditionalModule.registerWhen(
      ProfilerNoopModule.forRoot({ isGlobal: true }),
      (env) => !isProfilerEnabled(env),
    ),
  ],
})
export class AppModule {}
```

Start the application, make a few requests, and open `http://localhost:3000/_profiler`. Every non-profiler response also carries an `X-Debug-Token-Link` header pointing straight to its profile.

> A top-level `enabled` option is also supported as an alternative, documented once in [Configuration → Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#enabling-and-disabling-the-profiler).

## Documentation

Each capability has its own focused guide:

| Guide                                                                                                                  | What it covers                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [Configuration](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration)                       | `forRoot` / `forRootAsync`, the full options reference, securing the UI with a Bearer token          |
| [Log capture](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/logs)                                  | Wrapping any logger so every entry lands in the profile, supported argument conventions              |
| [Browsing profiles](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/browsing-profiles)               | UI endpoints, debug headers, list filters (built-in and custom), exporting a profile                 |
| [Timeline & custom collectors](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/collectors)           | `startSpan()` timing, writing a collector with `@ProfilerCollector()`, custom EJS panels             |
| [Extending the UI with JavaScript](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/extending-the-ui) | CSP-friendly compiled bundles, the `window.NestProfiler` runtime, registering your own client script |
| [Custom protocol adapters](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/context-adapters)         | Profiling gRPC, Kafka, WebSockets… via `IContextAdapter`                                             |
| [Storage backends](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/storage)                          | In-memory (default), file system, custom `IProfilerStorageAdapter`                                   |
| [Performance impact & testing](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/performance)          | Deferred persistence, why it is free, `flush()` in automated tests                                   |

The [Getting started](https://nest-profiler.eleven-labs.com/docs/getting-started) guide covers the full setup including the optional collector packages (TypeORM, MikroORM, Mongoose, Axios, cache, auth, config, validator, GraphQL, commander), and the [Profiler UI](https://nest-profiler.eleven-labs.com/docs/profiler-ui) page gives a visual tour of every panel.

## Public API

```ts
import {
  ProfilerModule,
  ProfilerNoopModule,
  ProfilerService,
  NoopProfilerService,
  ProfilerStorageService,
  ProfilerViewsSetup,
  CollectorRegistry,
  ProfilerCollector,
  TimelineCollector,
  ClientAssetRegistry,
  PROFILER_STORAGE_ADAPTER,
  MemoryStorageAdapter,
  FileStorageAdapter,
  createProfilerLogger,
  parseLogArgs,
  DEFAULT_LOG_METHODS,
} from '@eleven-labs/nest-profiler';

import type {
  ProfilerModuleOptions,
  ProfilerModuleAsyncOptions,
  IProfilerCollector,
  IProfilerStorageAdapter,
  StorageFindOptions,
  CollectorPanelInfo,
  Profile,
  LogEntry,
  ExceptionEntry,
  TimelineSpan,
  EventEntry,
  SecurityContext,
  LogMethodMap,
  LogArgsParser,
  ParsedLogCall,
  ProfilerLoggerOptions,
} from '@eleven-labs/nest-profiler';
```

The full generated reference lives at [API reference — nest-profiler](https://nest-profiler.eleven-labs.com/docs/api-reference/nest-profiler).

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
