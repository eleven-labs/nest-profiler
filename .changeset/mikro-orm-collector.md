---
'@eleven-labs/nest-profiler-mikro-orm': minor
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-typeorm': patch
---

Add `@eleven-labs/nest-profiler-mikro-orm`, a MikroORM query collector that captures SQL queries in the Database panel via the ORM logger. The package ships as ESM-only (`"type": "module"`), matching `@mikro-orm/core` and `@mikro-orm/nestjs` v7 which are ESM-only — it must be consumed from an ESM host.

Introduce a shared `AbstractSqlQueryCollector` base (plus `QueryEntry`/`QueryType`/`detectQueryType` and the `sql-panel.ejs` template) in `@eleven-labs/nest-profiler` so SQL ORM collectors reuse the rendering contract. The TypeORM collector now extends this base (no public API change).
