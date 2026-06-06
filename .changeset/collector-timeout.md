---
'@eleven-labs/nest-profiler': minor
---

Add a configurable per-collector timeout via the `collectorTimeout` option (default `1000`ms; set `0` to disable).

A slow or hanging collector can no longer block the response or the profiler list page: once the timeout elapses the panel stores `{ error: 'timed out after <n>ms' }` and a warning is logged. Fast collectors are unaffected.
