# @eleven-labs/nest-profiler-mikro-orm

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
  <a href="https://codecov.io/gh/eleven-labs/nest-profiler/flags"><img alt="Coverage" src="https://codecov.io/gh/eleven-labs/nest-profiler/branch/main/graph/badge.svg?flag=nest-profiler-mikro-orm" /></a>
  <a href="https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-mikro-orm"><img alt="Documentation" src="https://img.shields.io/badge/docs-nest--profiler.eleven--labs.com-e5225a" /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a" />
  <img alt="Built with NestJS" src="https://img.shields.io/badge/built%20with-NestJS-ea2845" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Code style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" />
</p>

`@eleven-labs/nest-profiler-mikro-orm` captures every SQL query executed by [MikroORM](https://mikro-orm.io) during a profiled execution and displays them in a dedicated **Database** panel.

![Database panel — MikroORM SQL queries with type badge, duration bar and slow-query highlighting](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/mikro-orm.png)

## Installation

```bash
pnpm add @eleven-labs/nest-profiler-mikro-orm
```

**Peer dependencies:** `@mikro-orm/core ^7.0.0`, `@mikro-orm/nestjs ^7.0.0`

## Setup

Register `MikroOrmCollectorModule` **after** `MikroOrmModule` in your root module. No extra MikroORM
configuration is required — the collector wraps the ORM logger automatically:

```ts title="app.module.ts"
import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { MikroOrmCollectorModule } from '@eleven-labs/nest-profiler-mikro-orm';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] !== 'false';

@Module({
  imports: [
    MikroOrmModule.forRoot({
      driver: PostgreSqlDriver,
      // ...your connection options
    }),
    ConditionalModule.registerWhen(
      MikroOrmCollectorModule.forRoot({ slowQueryThreshold: 100 }), // ms — above this is highlighted
      isProfilerEnabled,
    ),
  ],
})
export class AppModule {}
```

> **Enabling / disabling** — gate the collector with `ConditionalModule.registerWhen(..., isProfilerEnabled)` as shown, so it loads only when `PROFILER_ENABLED` is on. Wire the core `ProfilerModule` and its `ProfilerNoopModule` fallback **once at the root** — the recommended setup bundles the root-level profiler modules into a single `ProfilingModule` behind two `ConditionalModule` gates (see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#enabling-and-disabling-the-profiler) and the [example app](https://nest-profiler.eleven-labs.com/docs/example-api)). A top-level `enabled` option is also supported as an alternative.

## What it collects

For each SQL query executed during a request:

| Field        | Description                                        |
| ------------ | -------------------------------------------------- |
| `sql`        | The SQL query string (with keyword highlighting)   |
| `parameters` | Bound parameters                                   |
| `duration`   | Execution time in ms (from MikroORM's `took`)      |
| `type`       | `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `OTHER`    |
| `isSlow`     | `true` if duration ≥ `slowQueryThreshold`          |
| `startedAt`  | Unix timestamp                                     |
| `error`      | Set when MikroORM reports the query at error level |

Slow queries are highlighted in red in the panel.

## Toolbar badge

The toolbar badge shows: `{n}q` (e.g., `5q`). When slow queries are present: `5q (2 slow)`.

## How it works

The collector wraps MikroORM's `Logger.logQuery` at module initialization (`OnModuleInit`).
MikroORM's SQL connection always measures execution time and calls `logQuery` with the query, its
parameters and the elapsed `took`; the collector pushes a query entry into the active request
profile (resolved via [`nestjs-cls`](https://github.com/Papooch/nestjs-cls)) and lets the original
logger handle console output only if you had query logging enabled. Queries executed outside a
request context (startup, background jobs) are silently ignored.

This captures all queries issued through the `EntityManager`, repositories and the QueryBuilder.

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
