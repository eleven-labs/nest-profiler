---
'@eleven-labs/nest-profiler-mongoose': patch
---

Capture the update document of `updateOne`, `updateMany`, `findOneAndUpdate`, `replaceOne` and `findOneAndReplace`. The MongoDB panel only showed the filter of an update, so what it wrote — the fields set, a date — was nowhere to be seen. The update is now displayed under the filter, redacted like it, and included in the copied `mongosh` command (`db.<collection>.updateOne(<filter>, <update>)`), so that command updates instead of failing. Top-level fields are shown under `$set`, the way mongoose sends them. The N+1 fingerprint of an update now includes the shape of its update, so two updates of different fields are no longer grouped together.
