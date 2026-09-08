---
'@eleven-labs/nest-profiler-mongoose': patch
---

Capture the payload of Mongoose write operations, which the MongoDB panel previously reported without any argument: a `bulkWrite` was shown (and copied) as `db.<collection>.bulkWrite({})`, and `insertMany` / `save` likewise, so nothing said what the request had written.

- Two new `MongooseQueryEntry` fields: `operations` (the bulk operations of a `bulkWrite`) and `documents` (the documents of an `insertMany` and the document of a `save` / `Model.create()`). They render as **Operations:** / **Documents:** blocks in the panel and feed the **Copy query** button, which now yields a runnable `db.<collection>.bulkWrite([…])` / `insertMany([…])`.
- The payload is an operation _input_, so — like a query `filter` — it is always captured (no `captureResult` needed), redacted, and **not** size-capped: the default `maxDepth` of 4 would already collapse the `$set` of a bulk operation to `[Object]`. It still goes through `toSafeData`, so a hydrated document is flattened via its `toJSON()` projection and a circular reference cannot break persistence.
- The payload is snapshotted before the write runs, since Mongoose mutates the documents it writes.
- The N+1 fingerprint of a write is now built from its payload shape instead of an always-empty filter, so repeated writes are no longer grouped as one pattern regardless of what they wrote.
- `insertMany` called with a single document (a shape Mongoose accepts) now reports `count: 1` instead of leaving it unset.

Writes issued through `Model.create()` — the most common write path — were also missing from the panel entirely: Mongoose freezes `Model.prototype.$save` as an alias of `save` at load time and `create()` / `insertOne()` call that alias, so patching `save` alone never saw them. Both are now patched (each wrapping its own original, so a `document.save()` is still recorded exactly once).
