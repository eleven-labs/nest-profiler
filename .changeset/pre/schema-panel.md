---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-typeorm': minor
'@eleven-labs/nest-profiler-mikro-orm': minor
'@eleven-labs/nest-profiler-mongoose': minor
---

Add a global "Schema" panel per ORM listing the registered entities and their columns, relations and indexes.

- `nest-profiler`: add a shared `AbstractSchemaCollector` (global-scope, introspects once at bootstrap and caches) plus the normalized `EntitySchema`/`ColumnInfo`/`RelationInfo`/`IndexInfo` types and a single `schema-panel.ejs` rendering one collapsible section per entity — mirroring the `AbstractSqlQueryCollector` + shared `sql-panel.ejs` trajectory. Column defaults are passed through `redactString`, and an empty introspection despite a present ORM handle emits a diagnosable `Logger.warn` canary.
- `nest-profiler-typeorm`: add `TypeOrmSchemaCollectorModule` — introspects `dataSource.entityMetadatas` (columns, relations, indices), honours `connectionName`, and no-ops when no DataSource is wired or initialized.
- `nest-profiler-mikro-orm`: add `MikroOrmSchemaCollectorModule` — introspects `orm.getMetadata().getAll()` (props, relations, indexes/uniques), honours `connectionName`, and no-ops when no context is wired.
- `nest-profiler-mongoose`: add `MongooseSchemaCollectorModule` — introspects each model's `schema.paths` and `schema.indexes()` (fields, `ref` relations, indexes), honours `connectionName`, and no-ops when no connection is wired.
