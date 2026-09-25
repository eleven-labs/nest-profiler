# @eleven-labs/nest-profiler-config

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
  <a href="https://codecov.io/gh/eleven-labs/nest-profiler/flags"><img alt="Coverage" src="https://codecov.io/gh/eleven-labs/nest-profiler/branch/main/graph/badge.svg?flag=nest-profiler-config" /></a>
  <a href="https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-config"><img alt="Documentation" src="https://img.shields.io/badge/docs-nest--profiler.eleven--labs.com-e5225a" /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a" />
  <img alt="Built with NestJS" src="https://img.shields.io/badge/built%20with-NestJS-ea2845" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Code style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" />
</p>

`@eleven-labs/nest-profiler-config` takes a snapshot of the application configuration at startup and displays it in a **Config** panel. Secret values are automatically masked.

![Config panel — flattened configuration keys with secret values masked](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/config.png)

## Installation

```bash
pnpm add -D @eleven-labs/nest-profiler-config
pnpm add @nestjs/config
```

**Peer dependencies:** `@nestjs/config ^4.0.0`

`@nestjs/config` is your application's own configuration library, so it stays a regular dependency; only the collector is profiler-only.

## Setup

Your `ConfigModule` stays in the production `AppModule`, unchanged:

```ts title="app.module.ts"
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
})
export class AppModule {}
```

The collector goes in the dev-only profiling bundle:

```ts title="profiling/profiling.module.ts"
import { Module } from '@nestjs/common';
import { ProfilerModule } from '@eleven-labs/nest-profiler';
import { ConfigCollectorModule } from '@eleven-labs/nest-profiler-config';

@Module({
  imports: [
    ProfilerModule.forRoot({ isGlobal: true }),
    ConfigCollectorModule.forRoot({ maskKeys: ['DATABASE_URL', 'JWT_SECRET'] }),
  ],
})
export class ProfilingModule {}
```

> `ProfilingModule` is the dev-only bundle loaded by `main-dev.ts` — see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#recommended-install-it-as-a-dev-dependency). If the profiler is installed as a production dependency behind the [runtime gate](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#when-production-code-calls-the-profiler-conditionalmodule), wrap the same call in `ConditionalModule.registerWhen(..., isProfilerEnabled)`.

## What it collects

The full configuration object (from `ConfigService`'s internal store), **grouped by namespace**. Each top-level namespace registered with `registerAs` — whether loaded via `ConfigModule.forRoot({ load: [...] })` **or** `ConfigModule.forFeature(...)` — becomes its own collapsible section, with its keys shown relative to the namespace. Top-level scalar values are gathered under a synthetic **General** group:

```
▸ General
    port      = 3000
    NODE_ENV  = development
▸ database
    host      = localhost
    port      = 5432
    password  = ***
```

Within a group, nested objects are flattened with `.` separators (e.g. `pool.max`). Grouping is purely structural: `@nestjs/config` merges `forRoot` and `forFeature` configuration into the same store, so their origin is not distinguished — a namespace is identified by its shape (a nested object at the top level), not by how it was loaded.

## Automatic masking

Keys matching the pattern `/password|secret|key|token|credential|api_key|apikey/i` are automatically replaced with `***`. Additional keys can be specified via `maskKeys`.

## Toolbar badge

Number of configuration keys loaded (e.g., `12`).

## How it works

At `OnApplicationBootstrap`, the collector accesses `ConfigService`'s internal configuration store via `configService.internalConfig` (an internal property, not part of the public API). The snapshot is captured once at startup and returned for every profile — it does not re-read config on each execution.

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
