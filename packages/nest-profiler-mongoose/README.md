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
  <a href="https://codecov.io/gh/eleven-labs/nest-profiler/flags"><img alt="Coverage" src="https://codecov.io/gh/eleven-labs/nest-profiler/branch/main/graph/badge.svg?flag=nest-profiler-mongoose" /></a>
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

**Peer dependencies:** `mongoose ^9.0.0`, `@nestjs/mongoose ^11.0.0`

## Setup

```ts title="reviews.module.ts"
import { ConditionalModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MongooseCollectorModule } from '@eleven-labs/nest-profiler-mongoose';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] === 'true';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Review.name, schema: ReviewSchema }]),
    ConditionalModule.registerWhen(
      MongooseCollectorModule.forRoot({ slowThreshold: 100, duplicateThreshold: 2 }), // slow/N+1 tagging
      isProfilerEnabled,
    ),
  ],
})
export class AppModule {}
```

`MongooseModule.forRoot()` (or `forRootAsync`) must be registered in `AppModule` before using `MongooseCollectorModule`.

> **Enabling / disabling** — gate the collector with `ConditionalModule.registerWhen(..., isProfilerEnabled)` as shown, so it loads only when `PROFILER_ENABLED` is on. Wire the core `ProfilerModule` and its `ProfilerNoopModule` fallback **once at the root** — the recommended setup bundles the root-level profiler modules into a single `ProfilingModule` behind two `ConditionalModule` gates (see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#enabling-and-disabling-the-profiler) and the [example app](https://nest-profiler.eleven-labs.com/docs/example-api)). A top-level `enabled` option is also supported as an alternative.

## What it collects

For each Mongoose query or aggregation executed during a request:

| Field         | Description                                               |
| ------------- | --------------------------------------------------------- |
| `collection`  | MongoDB collection name (e.g. `reviews`)                  |
| `operation`   | Mongoose operation (e.g. `find`, `aggregate`)             |
| `filter`      | Query filter object (if applicable)                       |
| `duration`    | Execution time in ms                                      |
| `startedAt`   | Unix timestamp                                            |
| `count`       | Number of results returned (find queries only)            |
| `error`       | Error message if the query failed                         |
| `fingerprint` | `collection + operation + filter shape`, for N+1 grouping |
| `tags`        | Performance tags applied by the core rule engine          |

Slow queries and N+1 patterns are flagged by the core rule engine and shown as coloured pills (and filterable on the list page). See [Performance tags](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/performance-tags).

## Toolbar badge

The toolbar badge shows: `{n}q` (e.g., `4q`). When slow queries are present: `4q (1 slow)`.

## How it works

At module initialization, the collector patches `mongoose.Query.prototype.exec` and `mongoose.Aggregate.prototype.exec` on the Mongoose instance retrieved from `connection.base`. This captures all queries regardless of when schemas were registered, and is fully transparent — Mongoose behavior is unchanged.

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
