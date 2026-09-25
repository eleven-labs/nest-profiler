# ORM query collectors — TypeORM · MikroORM · Mongoose

The three ORM collectors share one shape: a **query collector** that times every statement and tags `slow` / `n-plus-one` / `chatty`, plus an optional **Schema collector** companion that adds a global home-page panel listing the registered entities/models. Each is registered in the `ProfilingModule` bundle (see `collectors-matrix.md`).

Shared query options (same defaults across the three):

| Option           | Type      | Default | Notes                                                               |
| ---------------- | --------- | ------- | ------------------------------------------------------------------- |
| `enabled`        | `boolean` | `true`  | Synchronous.                                                        |
| `connectionName` | `string`  | —       | select a non-default DataSource / connection; omit for the default. |

**Performance thresholds** — `slowThreshold` (100 ms), `nPlusOneThreshold` (2), `chattyThreshold` (20): the same trio on all three ORMs; tune per DB (drive from `ConfigService`). Detail lives in the `interpret-performance-tags` skill and each package's docs.

Schema collector options: `enabled` (`true`), `connectionName`.

**Key questions to ask:** (1) add the **Schema panel** companion too? (2) keep the default thresholds or tune `slowThreshold` for this DB?

Both `forRoot(options)` and `forRootAsync({ inject, useFactory })` are available on all six modules — use `forRootAsync` to drive thresholds from `ConfigService`.

---

## TypeORM — `@eleven-labs/nest-profiler-typeorm`

- **Peers (required):** `@nestjs/typeorm@^11`, `typeorm@>=0.3.20 <2`, `nestjs-cls@^6`.
- **Modules:** `TypeOrmCollectorModule` (query) + `TypeOrmSchemaCollectorModule` (schema panel).
- **Placement:** the `ProfilingModule` bundle; the app keeps `TypeOrmModule` in its own modules (`AppDevModule` imports `AppModule` before the bundle).
- **Gotcha:** the collector resolves the `DataSource` itself via `getDataSourceToken(connectionName)` — **no `inject: [DataSource]` needed**. For a named DataSource, pass `connectionName`.
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-typeorm> · tutorial: <https://nest-profiler.eleven-labs.com/docs/tutorials/sql-collectors>

```ts
import { TypeOrmCollectorModule, TypeOrmSchemaCollectorModule } from '@eleven-labs/nest-profiler-typeorm';

// in ProfilingModule's imports:
TypeOrmCollectorModule.forRoot({ slowThreshold: 100 }),
TypeOrmSchemaCollectorModule.forRoot(),
```

## MikroORM — `@eleven-labs/nest-profiler-mikro-orm`

- **Peers (required):** `@mikro-orm/core@^7`, `@mikro-orm/nestjs@^7`, `nestjs-cls@^6`.
- **Modules:** `MikroOrmCollectorModule` + `MikroOrmSchemaCollectorModule`.
- **Placement:** the `ProfilingModule` bundle; the app keeps `MikroOrmModule` in its own modules.
- **Gotcha:** the **only ESM-only collector** — the app must be `"type": "module"` and use `.js` import specifiers. It wraps the ORM logger on init; no `dataSource` needed. `connectionName` selects a non-default context.
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-mikro-orm> · tutorial: <https://nest-profiler.eleven-labs.com/docs/tutorials/sql-collectors>

```ts
import { MikroOrmCollectorModule, MikroOrmSchemaCollectorModule } from '@eleven-labs/nest-profiler-mikro-orm';

// in ProfilingModule's imports:
MikroOrmCollectorModule.forRoot({ slowThreshold: 100 }),
MikroOrmSchemaCollectorModule.forRoot(),
```

## Mongoose — `@eleven-labs/nest-profiler-mongoose`

- **Peers (required):** `@nestjs/mongoose@^11`, `mongoose@^8 || ^9`, `nestjs-cls@^6`.
- **Modules:** `MongooseCollectorModule` + `MongooseSchemaCollectorModule`.
- **Placement:** the `ProfilingModule` bundle; the app keeps `MongooseModule.forRoot(...)` in its own modules.
- **Gotcha:** patches `Query` / `Aggregate` `exec`. `connectionName` selects a non-default connection.
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-mongoose> · tutorial: <https://nest-profiler.eleven-labs.com/docs/tutorials/mongoose-collector>

```ts
import { MongooseCollectorModule, MongooseSchemaCollectorModule } from '@eleven-labs/nest-profiler-mongoose';

// in ProfilingModule's imports:
MongooseCollectorModule.forRoot({ slowThreshold: 100 }),
MongooseSchemaCollectorModule.forRoot(),
```
