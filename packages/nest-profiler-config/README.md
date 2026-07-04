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
pnpm add @eleven-labs/nest-profiler-config @nestjs/config
```

**Peer dependencies:** `@nestjs/config ^4.0.0`

## Setup

```ts title="app.module.ts"
import { ConfigModule, ConditionalModule } from '@nestjs/config';
import { ConfigCollectorModule } from '@eleven-labs/nest-profiler-config';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] === 'true';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ConditionalModule.registerWhen(
      ConfigCollectorModule.forRoot({ maskKeys: ['DATABASE_URL', 'JWT_SECRET'] }),
      isProfilerEnabled,
    ),
  ],
})
export class AppModule {}
```

> **Enabling / disabling** — gate the collector with `ConditionalModule.registerWhen(..., isProfilerEnabled)` as shown, so it loads only when `PROFILER_ENABLED` is on. Wire the core `ProfilerModule` and its `ProfilerNoopModule` fallback **once at the root** — the recommended setup bundles the root-level profiler modules into a single `ProfilingModule` behind two `ConditionalModule` gates (see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#enabling-and-disabling-the-profiler) and the [example app](https://nest-profiler.eleven-labs.com/docs/example-api)). A top-level `enabled` option is also supported as an alternative.

## What it collects

The full configuration object (from `ConfigService`'s internal store), flattened to dot-notation keys:

```
db.host      = localhost
db.password  = ***
port         = 3000
NODE_ENV     = development
```

Nested objects are flattened with `.` separators.

## Automatic masking

Keys matching the pattern `/password|secret|key|token|credential|api_key|apikey/i` are automatically replaced with `***`. Additional keys can be specified via `maskKeys`.

## Toolbar badge

Number of configuration keys loaded (e.g., `12`).

## How it works

At `OnApplicationBootstrap`, the collector accesses `ConfigService`'s internal configuration store via `configService.internalConfig` (an internal property, not part of the public API). The snapshot is captured once at startup and returned for every profile — it does not re-read config on each execution.

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
