# @eleven-labs/nest-profiler-cache

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
  <a href="https://codecov.io/gh/eleven-labs/nest-profiler/flags"><img alt="Coverage" src="https://codecov.io/gh/eleven-labs/nest-profiler/branch/main/graph/badge.svg?flag=nest-profiler-cache" /></a>
  <a href="https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-cache"><img alt="Documentation" src="https://img.shields.io/badge/docs-nest--profiler.eleven--labs.com-e5225a" /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a" />
  <img alt="Built with NestJS" src="https://img.shields.io/badge/built%20with-NestJS-ea2845" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Code style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" />
</p>

`@eleven-labs/nest-profiler-cache` intercepts `@nestjs/cache-manager` operations (GET HIT, GET MISS, SET, DEL) during a profiled execution and displays them in a **Cache** panel with hit/miss statistics.

![Cache panel — GET_HIT / GET_MISS / SET / DEL operations with the hit-ratio badge](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/cache.png)

## Installation

```bash
pnpm add @eleven-labs/nest-profiler-cache @nestjs/cache-manager
```

**Peer dependencies:** `@nestjs/cache-manager ^3.0.0`

## Setup

```ts title="app.module.ts"
import { ConditionalModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { CacheCollectorModule } from '@eleven-labs/nest-profiler-cache';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] !== 'false';

@Module({
  imports: [
    CacheModule.register({ isGlobal: true }),
    ConditionalModule.registerWhen(CacheCollectorModule.forRoot(), isProfilerEnabled),
  ],
})
export class AppModule {}
```

> **Enabling / disabling** — gate the collector with `ConditionalModule.registerWhen(..., isProfilerEnabled)` as shown, so it loads only when `PROFILER_ENABLED` is on. Wire the core `ProfilerModule` and its `ProfilerNoopModule` fallback **once at the root** — the recommended setup bundles the root-level profiler modules into a single `ProfilingModule` behind two `ConditionalModule` gates (see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#enabling-and-disabling-the-profiler) and the [example app](https://nest-profiler.eleven-labs.com/docs/example-api)). A top-level `enabled` option is also supported as an alternative.

## What it collects

For each cache operation:

| Field       | Description                            |
| ----------- | -------------------------------------- |
| `operation` | `GET_HIT`, `GET_MISS`, `SET`, or `DEL` |
| `key`       | Cache key                              |
| `duration`  | Operation duration in ms               |
| `startedAt` | Unix timestamp                         |

The panel also displays an aggregated hit/miss ratio.

## Toolbar badge

`{hits}H/{misses}M` (e.g., `8H/2M`). When no GET operations: `{n}ops`.

## How it works

At module initialization, the collector wraps the `CACHE_MANAGER`'s `get`, `set`, and `del` methods using a JavaScript `Proxy`. Each wrapped call records the operation type, key, and duration into the current request profile.

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
