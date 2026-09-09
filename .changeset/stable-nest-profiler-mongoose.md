---
'@eleven-labs/nest-profiler-mongoose': major
---

First stable release. `@eleven-labs/nest-profiler-mongoose` captures every Mongoose query and aggregation run during a profiled execution and shows it in a **MongoDB** panel.

- `MongooseCollectorModule` records the collection, operation, filter, write payload, duration and result count of each call, and feeds the shared performance rules.
- `MongooseSchemaCollectorModule` adds a global **Schema** panel listing the registered models with their paths, types and indexes.
- Named connections are supported through `connectionName`; the module no-ops instead of crashing when no connection is wired.

Requires Node >= 22, NestJS 11 and `@eleven-labs/nest-profiler` ^1.0.0, with `mongoose` ^8 || ^9 and `@nestjs/mongoose` ^11 as peers.

Documentation: https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-mongoose
