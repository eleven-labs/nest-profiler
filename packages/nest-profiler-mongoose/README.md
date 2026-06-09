# @eleven-labs/nest-profiler-mongoose

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
  <a href="https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-mongoose"><img alt="Documentation" src="https://img.shields.io/badge/docs-nest--profiler.eleven--labs.com-e5225a" /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a" />
  <img alt="Built with NestJS" src="https://img.shields.io/badge/built%20with-NestJS-ea2845" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Code style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" />
</p>

`@eleven-labs/nest-profiler-mongoose` captures every Mongoose query and aggregation executed during a profiled execution and displays them in a dedicated **MongoDB** panel.

![MongoDB panel — Mongoose queries and aggregations with operation badge, collection, duration and result count](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/mongodb.png)

## Installation

```bash
pnpm add @eleven-labs/nest-profiler-mongoose
```

**Peer dependencies:** `mongoose ^8.0.0`, `@nestjs/mongoose ^11.0.0`

## Setup

```ts title="reviews.module.ts"
import { MongooseModule } from '@nestjs/mongoose';
import { MongooseCollectorModule } from '@eleven-labs/nest-profiler-mongoose';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Review.name, schema: ReviewSchema }]),
    MongooseCollectorModule.forRoot({
      slowQueryThreshold: 100, // ms — queries above this are highlighted (default: 100)
    }),
  ],
})
export class ReviewsModule {}
```

`MongooseModule.forRoot()` (or `forRootAsync`) must be registered in `AppModule` before using `MongooseCollectorModule`.

## What it collects

For each Mongoose query or aggregation executed during a request:

| Field        | Description                                    |
| ------------ | ---------------------------------------------- |
| `collection` | MongoDB collection name (e.g. `reviews`)       |
| `operation`  | Mongoose operation (e.g. `find`, `aggregate`)  |
| `filter`     | Query filter object (if applicable)            |
| `duration`   | Execution time in ms                           |
| `isSlow`     | `true` if duration ≥ `slowQueryThreshold`      |
| `startedAt`  | Unix timestamp                                 |
| `count`      | Number of results returned (find queries only) |
| `error`      | Error message if the query failed              |

Slow queries are highlighted in red in the panel.

## Toolbar badge

The toolbar badge shows: `{n}q` (e.g., `4q`). When slow queries are present: `4q (1 slow)`.

## How it works

At module initialization, the collector patches `mongoose.Query.prototype.exec` and `mongoose.Aggregate.prototype.exec` on the Mongoose instance retrieved from `connection.base`. This captures all queries regardless of when schemas were registered, and is fully transparent — Mongoose behavior is unchanged.

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
