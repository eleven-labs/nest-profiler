---
'@eleven-labs/nest-profiler-typeorm': patch
'@eleven-labs/nest-profiler-axios': patch
'@eleven-labs/nest-profiler-cache': patch
'@eleven-labs/nest-profiler-mikro-orm': patch
---

Make host-library instrumentation idempotent with a `__profilerPatched` guard, matching the Mongoose collector. Re-initialization (tests, multiple data sources/ORMs) no longer double-wraps queries, HTTP requests or cache operations, which previously caused entries to be recorded twice.
