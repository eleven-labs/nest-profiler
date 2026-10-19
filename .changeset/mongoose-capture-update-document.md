---
'@eleven-labs/nest-profiler-mongoose': patch
---

Capture what each operation actually sent to MongoDB. The MongoDB panel and its **Copy query** command left out part of an operation's arguments, so the command could fail or return something else, and some counts were wrong:

- The update document of `updateOne`, `updateMany`, `findOneAndUpdate`, `replaceOne` and `findOneAndReplace` is now captured, as Mongoose sent it: top-level fields under `$set`, with the `updatedAt` of the timestamps plugin and the upsert defaults. It is shown under the filter and passed to the command (`db.<collection>.updateOne(<filter>, <update>)`).
- The projection and the options of a query (`sort`, `skip`, `limit`, `upsert`, `arrayFilters`, `collation`…) and of an aggregation (`allowDiskUse`…) are now captured and passed to the command, the session left out.
- A `distinct` now captures its field: `db.<collection>.distinct(<field>, <filter>)`.
- The operations of a `bulkWrite` are captured as Mongoose cast them (`$set`, timestamps), and its count is the number of documents it affected, not its number of operations — a bulk that matched nothing now trips the zero-rows rule.
- An `insertMany` captures the documents it inserted (defaults, `_id`, timestamps), and when it fails part-way its count is the number of documents inserted all the same.
- A `save()` is recorded as the operation it sends — `insertOne` of a new document, `updateOne` of the modified paths of an existing one, or the `findOne` Mongoose checks an unmodified one with — instead of a `save` that `mongosh` does not know.

The N+1 fingerprint now includes the shape of an update and the field of a `distinct`, so two updates of different fields are no longer grouped together.
