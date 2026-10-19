---
'@eleven-labs/nest-profiler-typeorm': patch
---

Support `@nestjs/typeorm` 12. It is ESM-only, so the collector no longer imports it at runtime — it computes the DataSource injection token itself — and the package still loads with `require()` from a CommonJS app. The peer dependency now accepts `^11.0.0 || ^12.0.0`.
