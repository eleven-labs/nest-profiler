---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-routes': patch
---

The Routes panel no longer lists the profiler's own UI/API routes (`/_profiler/...`).

- `@eleven-labs/nest-profiler` exports `PROFILER_BASE_PATH`, the fixed base path where the profiler UI is mounted.
- `HttpRouteSource` filters out any scanned route whose path starts with `PROFILER_BASE_PATH` before building the **REST** group.
