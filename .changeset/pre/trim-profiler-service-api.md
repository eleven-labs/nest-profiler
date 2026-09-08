---
'@eleven-labs/nest-profiler': minor
---

Trim the `ProfilerService` public API down to what earns its place.

`ProfilerService` now exposes only `startSpan`, `getCurrentToken` and `flush`. The manual enrichment methods have been removed because they duplicated automatic capture or had no consumer:

- **`addException`** — exceptions are already captured automatically by the exception filter and the interceptor, so `profile.exceptions` is populated without it.
- **`setSecurityContext`** — the security context is already set automatically by `@eleven-labs/nest-profiler-auth`, so `profile.security` is populated without it.
- **`addEvent`** — the events feature had no producer and was rendered nowhere. The method, the `EventEntry` type, the `profile.events` field and the `EventEntry` export are all removed.

**Breaking changes:**

- Removed `ProfilerService.addException`, `ProfilerService.addEvent` and `ProfilerService.setSecurityContext` (and their `NoopProfilerService` counterparts).
- Removed the `EventEntry` type export and the `Profile.events` field.

Custom timeline instrumentation still lives on `ProfilerService.startSpan(...)`; exceptions and the security panel keep working through their automatic capture.
