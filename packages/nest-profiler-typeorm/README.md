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
pnpm add -D @eleven-labs/nest-profiler-typeorm
```

**Peer dependencies:** `typeorm ^1.0.0`, `@nestjs/typeorm ^11.0.0` — your app's own dependencies, installed with a plain `pnpm add`.

## Setup

Keep `TypeOrmModule.forRoot({ ... })` in your application module, and register the collector in the dev-only profiling bundle:

```ts title="profiling/profiling.module.ts"
import { Module } from '@nestjs/common';
import { ProfilerModule } from '@eleven-labs/nest-profiler';
import { TypeOrmCollectorModule } from '@eleven-labs/nest-profiler-typeorm';

@Module({
  imports: [
    ProfilerModule.forRoot({ isGlobal: true }),
    TypeOrmCollectorModule.forRoot({
      slowThreshold: 100, // ms — queries at/above this are tagged `slow` (default: 100)
      nPlusOneThreshold: 2, // identical queries repeated ≥ N are tagged `n-plus-one` / N+1 (default: 2)
      slowSeverity: 'warning', // severity of the `slow` tag — 'info' | 'warning' | 'danger' (default: warning)
    }),
  ],
})
export class ProfilingModule {}
```

> `ProfilingModule` is the dev-only bundle loaded by `main-dev.ts` — see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#recommended-install-it-as-a-dev-dependency). If the profiler is installed as a production dependency behind the [runtime gate](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#when-production-code-calls-the-profiler-conditionalmodule), wrap the same call in `ConditionalModule.registerWhen(..., isProfilerEnabled)`.

The collector resolves the TypeORM `DataSource` by its injection token, so it needs no wiring next to `TypeOrmModule`; pass `connectionName` to instrument a named DataSource (omit it for the default connection). `AppDevModule` imports the bundle after `AppModule`, so the DataSource is already initialized when the collector patches it. To resolve the options from a provider such as `ConfigService`, use `forRootAsync`:

```ts
TypeOrmCollectorModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    slowThreshold: config.get<number>('PROFILER_SLOW_QUERY_MS') ?? 50,
  }),
}),
```

## What it collects

For each SQL query executed during a request:

| Field         | Description                                          |
| ------------- | ---------------------------------------------------- |
| `sql`         | The SQL query string (with keyword highlighting)     |
| `parameters`  | Bound parameters                                     |
| `duration`    | Execution time in ms                                 |
| `type`        | `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `OTHER`      |
| `startedAt`   | Unix timestamp                                       |
| `error`       | Error message if the query failed                    |
| `streaming`   | `true` for streaming reads (`QueryBuilder.stream()`) |
| `rowCount`    | Rows affected (writes) or returned (reads)           |
| `connection`  | Connection endpoint `host:port` (no credentials)     |
| `database`    | Target database name                                 |
| `fingerprint` | Parameter-free normalized SQL, used to group N+1s    |
| `tags`        | Performance tags applied by the core rule engine     |

Slow queries, N+1 patterns and silent zero-row `UPDATE`/`DELETE`s (the `zero-rows` tag) are flagged by the core rule engine and shown as coloured pills in the panel (and filterable on the list page). Configure the thresholds with `slowThreshold` / `nPlusOneThreshold` / `chattyThreshold`, and each tag's severity with `slowSeverity` / `nPlusOneSeverity` / `chattySeverity` / `zeroRowsSeverity` (`'info' | 'warning' | 'danger'`); see [Performance tags](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/performance-tags).

## Toolbar badge

The toolbar badge shows: `{n}q` (e.g., `5q`). When slow queries are present: `5q (2 slow)`.

`rowCount` is best-effort per driver: an array result yields its length; a `QueryResult`-style object yields its `affected` / `rowCount` / `affectedRows` / `changes`. A write on a driver that exposes none stays `undefined` (never a spurious `0`), and streamed reads never capture a row count. `connection` / `database` are read once from the DataSource options, and `connection` is omitted for drivers without a host/port (e.g. sqlite).

## How it works

The collector patches `dataSource.createQueryRunner()` at module initialization to wrap every `QueryRunner.query()` call with timing, recording an entry into the active request profile (resolved via `nestjs-cls`); `TypeOrmCollector.collect()` then reads and returns those entries. This captures all queries from repositories, the `EntityManager`, and raw `dataSource.query()` calls. Queries executed outside a request context (e.g. during module initialization) are silently ignored. The patch is transparent — TypeORM behavior is unchanged.

**Streaming reads** — `Repository.stream()` / `QueryBuilder.stream()` go through `QueryRunner.stream()`, a separate path from `query()`. The collector also wraps `stream()`: it measures duration across the returned stream's lifetime by listening only to its terminal `end`/`close`/`error` events — never a `data` listener, so no rows are consumed or diverted from the caller — and records the entry with `streaming: true`. Streamed row counts are not captured (that would require tapping the data).

## Schema panel

`TypeOrmSchemaCollectorModule` adds a global **Schemas / TypeORM** view to the profiler home page, listing every registered entity with its columns (type, nullable, primary key, generated, default), relations (kind → target) and indexes (name, columns, unique). Unlike the per-request Database panel, this is static process-level data introspected **once** at startup — so it renders on the home page, under the sidebar's **Schemas** heading, not inside a profile.

![Schemas / TypeORM view — the registered entities with their columns, types, primary keys and defaults](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/schema-typeorm.png)

Add it to the profiling bundle's `imports`:

```ts title="profiling/profiling.module.ts"
import { TypeOrmSchemaCollectorModule } from '@eleven-labs/nest-profiler-typeorm';

TypeOrmSchemaCollectorModule.forRoot(),
```

Pass `connectionName` to introspect a named DataSource (omit it for the default connection), and `enabled: false` to disable per environment. The panel reads `dataSource.entityMetadatas` and never touches data; column defaults are passed through the profiler's `redactString`, so a default embedding a secret (e.g. a DSN) is masked. The panel no-ops (does not appear) when no DataSource is wired or none is initialized.

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
