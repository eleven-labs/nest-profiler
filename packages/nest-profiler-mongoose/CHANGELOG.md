# @eleven-labs/nest-profiler-mongoose

## 1.2.1

### Patch Changes

- 042e974: Capture what each operation actually sent to MongoDB. The MongoDB panel and its **Copy query** command left out part of an operation's arguments, so the command could fail or return something else, and some counts were wrong:

  - The update document of `updateOne`, `updateMany`, `findOneAndUpdate`, `replaceOne` and `findOneAndReplace` is now captured, as Mongoose sent it: top-level fields under `$set`, with the `updatedAt` of the timestamps plugin and the upsert defaults. It is shown under the filter and passed to the command (`db.<collection>.updateOne(<filter>, <update>)`).
  - The projection and the options of a query (`sort`, `skip`, `limit`, `upsert`, `arrayFilters`, `collation`…) and of an aggregation (`allowDiskUse`…) are now captured and passed to the command, the session left out.
  - A `distinct` now captures its field: `db.<collection>.distinct(<field>, <filter>)`.
  - The operations of a `bulkWrite` are captured as Mongoose cast them (`$set`, timestamps), and its count is the number of documents it affected, not its number of operations — a bulk that matched nothing now trips the zero-rows rule.
  - An `insertMany` captures the documents it inserted (defaults, `_id`, timestamps), and when it fails part-way its count is the number of documents inserted all the same.
  - A `save()` is recorded as the operation it sends — `insertOne` of a new document, `updateOne` of the modified paths of an existing one, or the `findOne` Mongoose checks an unmodified one with — instead of a `save` that `mongosh` does not know.

  The N+1 fingerprint now includes the shape of an update and the field of a `distinct`, so two updates of different fields are no longer grouped together.

- 18c1e52: Support `nestjs-cls` 7: the peer dependency now accepts `^6.0.0 || ^7.0.0`.

  With `nestjs-cls` 7, the MikroORM collector captured no queries. `nestjs-cls` now ships an ESM build next to its CommonJS one, so the `ClsService` this ESM package imported was not the class the core registered, and resolving it found nothing. The collector now reads the request context through `ClsServiceManager`, which `nestjs-cls` shares between its two builds.

## 1.0.0

### Major Changes

- 3a507ec: First stable release. `@eleven-labs/nest-profiler-mongoose` captures every Mongoose query and aggregation run during a profiled execution and shows it in a **MongoDB** panel.

  - `MongooseCollectorModule` records the collection, operation, filter, write payload, duration and result count of each call, and feeds the shared performance rules.
  - `MongooseSchemaCollectorModule` adds a global **Schema** panel listing the registered models with their paths, types and indexes.
  - Named connections are supported through `connectionName`; the module no-ops instead of crashing when no connection is wired.

  Requires Node >= 22, NestJS 11 and `@eleven-labs/nest-profiler` ^1.0.0, with `mongoose` ^8 || ^9 and `@nestjs/mongoose` ^11 as peers.

  Documentation: https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-mongoose
