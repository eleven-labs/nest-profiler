# @eleven-labs/nest-profiler-typeorm

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
  <a href="https://codecov.io/gh/eleven-labs/nest-profiler/flags"><img alt="Coverage" src="https://codecov.io/gh/eleven-labs/nest-profiler/branch/main/graph/badge.svg?flag=nest-profiler-typeorm" /></a>
  <a href="https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-typeorm"><img alt="Documentation" src="https://img.shields.io/badge/docs-nest--profiler.eleven--labs.com-e5225a" /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a" />
  <img alt="Built with NestJS" src="https://img.shields.io/badge/built%20with-NestJS-ea2845" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Code style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" />
</p>

`@eleven-labs/nest-profiler-typeorm` captures every SQL query executed by TypeORM during a profiled execution and displays them in a dedicated **Database** panel.

![Database panel — TypeORM SQL queries with type badge, duration bar and slow-query highlighting](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/database.png)

## Installation

```bash
pnpm add @eleven-labs/nest-profiler-typeorm
```

**Peer dependencies:** `typeorm ^1.0.0`, `@nestjs/typeorm ^11.0.0`

## Setup

```ts title="app.module.ts"
import { ConditionalModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TypeOrmCollectorModule } from '@eleven-labs/nest-profiler-typeorm';
import { DataSource } from 'typeorm';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] === 'true'

@Module({
  imports: [
    TypeOrmModule.forRoot({ ... }),
    ConditionalModule.registerWhen(
      TypeOrmCollectorModule.forRoot({
        dataSource, // your DataSource instance
        slowThreshold: 100, // ms — queries at/above this are tagged `slow` (default: 100)
        duplicateThreshold: 2, // identical queries repeated ≥ N are tagged `duplicate` / N+1 (default: 2)
      }),
      isProfilerEnabled,
    ),
  ],
})
export class AppModule {}
```

Since `DataSource` is not available at module declaration time, use `forRootAsync`:

```ts
ConditionalModule.registerWhen(
  TypeOrmCollectorModule.forRootAsync({
    inject: [DataSource],
    useFactory: (dataSource: DataSource) => ({ dataSource, slowThreshold: 50 }),
  }),
  isProfilerEnabled,
),
```

> **Enabling / disabling** — gate the collector with `ConditionalModule.registerWhen(..., isProfilerEnabled)` as shown, so it loads only when `PROFILER_ENABLED` is on. Wire the core `ProfilerModule` and its `ProfilerNoopModule` fallback **once at the root** — the recommended setup bundles the root-level profiler modules into a single `ProfilingModule` behind two `ConditionalModule` gates (see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#enabling-and-disabling-the-profiler) and the [example app](https://nest-profiler.eleven-labs.com/docs/example-api)). A top-level `enabled` option is also supported as an alternative.

## What it collects

For each SQL query executed during a request:

| Field         | Description                                       |
| ------------- | ------------------------------------------------- |
| `sql`         | The SQL query string (with keyword highlighting)  |
| `parameters`  | Bound parameters                                  |
| `duration`    | Execution time in ms                              |
| `type`        | `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `OTHER`   |
| `startedAt`   | Unix timestamp                                    |
| `error`       | Error message if the query failed                 |
| `fingerprint` | Parameter-free normalized SQL, used to group N+1s |
| `tags`        | Performance tags applied by the core rule engine  |

Slow queries and N+1 patterns are flagged by the core rule engine and shown as coloured pills in the panel (and filterable on the list page). Configure the thresholds with `slowThreshold` / `duplicateThreshold`; see [Performance tags](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/performance-tags).

## Toolbar badge

The toolbar badge shows: `{n}q` (e.g., `5q`). When slow queries are present: `5q (2 slow)`.

## How it works

The collector patches `dataSource.createQueryRunner()` at module initialization to wrap every `QueryRunner.query()` call with timing, recording an entry into the active request profile (resolved via `nestjs-cls`); `TypeOrmCollector.collect()` then reads and returns those entries. This captures all queries from repositories, the `EntityManager`, and raw `dataSource.query()` calls. Queries executed outside a request context (e.g. during module initialization) are silently ignored. The patch is transparent — TypeORM behavior is unchanged.

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
