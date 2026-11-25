# @eleven-labs/nest-profiler-mongoose

## 1.6.0

### Minor Changes

- 4621ad2: Show the Mongoose schema as documents rather than relational tables. The Schemas / Mongoose panel now lists embedded documents, arrays of subdocuments and nested objects under the field holding them, finds the references declared inside them, and names references `ref` / `ref[]` instead of a relational cardinality (`many-to-one` / `one-to-many`). A reference is now also listed as a field, and arrays show their element type (`String[]`). The panel opens with a Mermaid **Document diagram**: one block per model and embedded document, solid lines for embedding and dashed lines for references, and a shape embedded in several places (an address used for shipping and billing) drawn once. Schema collectors can declare a `document` data model, which switches the panel to fields, required and references.

## 1.4.0

### Minor Changes

- 68a0421: Ship an ESM build alongside the CommonJS one. The exports maps serve `import` from `dist/esm` and `require` from `dist`. A CommonJS application, which NestJS 12 keeps supporting, resolves the same CommonJS build as before. An ESM application now imports ESM throughout: on NestJS 12, whose packages are ESM, the profiler no longer makes it go through Node's `require()` of ES modules, which some runtimes turn off (see the [NestJS migration guide](https://docs.nestjs.com/migration-guide#esm-packages)).

  `@eleven-labs/nest-profiler-mikro-orm`, ESM only until now, gets a CommonJS build too, so every package resolves to the same module system as the application that loads it.

- 37746d8: Support NestJS 12 alongside NestJS 11. The peer ranges now accept both majors:

  - `@nestjs/common` and `@nestjs/core`: `^11.0.0 || ^12.0.0` (the core package keeps its `^11.1.4` floor on `@nestjs/core`, required by the `instrument` option).
  - `@nestjs/graphql`: `^13.0.0 || ^14.0.0`.
  - `@nestjs/config`: `^4.0.0 || ^12.0.0`.
  - `@nestjs/cache-manager`: `^3.0.0 || ^12.0.0`.
  - `@nestjs/event-emitter`: `^3.0.0 || ^12.0.0`.
  - `@nestjs/mongoose`: `^11.0.0 || ^12.0.0`.

  No code change is needed on the application side: install the NestJS 12 versions of these packages and the profiler keeps working. On NestJS 12, `@mikro-orm/nestjs` needs 7.1 or later and `@golevelup/nestjs-rabbitmq` 9.1 or later: earlier versions reject NestJS 12 in their own peer ranges.

  NestJS 12 ships its packages as ESM and keeps supporting CommonJS applications, which load them through Node's `require()` of ES modules (Node.js 22.12 or newer). The profiler packages ship CommonJS and load NestJS 12 the same way: a CommonJS application stays CommonJS.

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
