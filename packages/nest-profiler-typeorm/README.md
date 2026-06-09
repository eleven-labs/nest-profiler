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

**Peer dependencies:** `typeorm ^0.3.0`, `@nestjs/typeorm ^11.0.0`

## Setup

```ts title="app.module.ts"
import { TypeOrmModule } from '@nestjs/typeorm';
import { TypeOrmCollectorModule } from '@eleven-labs/nest-profiler-typeorm';
import { DataSource } from 'typeorm';

@Module({
  imports: [
    TypeOrmModule.forRoot({ ... }),
    TypeOrmCollectorModule.forRoot({
      dataSource,            // your DataSource instance
      slowQueryThreshold: 100, // ms — queries above this are highlighted (default: 100)
    }),
  ],
})
export class AppModule {}
```

Since `DataSource` is not available at module declaration time, use `forRootAsync`:

```ts
TypeOrmCollectorModule.forRootAsync({
  inject: [DataSource],
  useFactory: (dataSource: DataSource) => ({ dataSource, slowQueryThreshold: 50 }),
}),
```

## What it collects

For each SQL query executed during a request:

| Field        | Description                                      |
| ------------ | ------------------------------------------------ |
| `sql`        | The SQL query string (with keyword highlighting) |
| `parameters` | Bound parameters                                 |
| `duration`   | Execution time in ms                             |
| `type`       | `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `OTHER`  |
| `isSlow`     | `true` if duration ≥ `slowQueryThreshold`        |
| `startedAt`  | Unix timestamp                                   |
| `error`      | Error message if the query failed                |

Slow queries are highlighted in red in the panel.

## Toolbar badge

The toolbar badge shows: `{n}q` (e.g., `5q`). When slow queries are present: `5q (2 slow)`.

## How it works

The collector patches `dataSource.driver.query` at module initialization to wrap every query execution with timing. The patch is transparent — TypeORM behavior is unchanged.

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
