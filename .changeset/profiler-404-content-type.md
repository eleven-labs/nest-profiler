---
'@eleven-labs/nest-profiler': patch
---

A 404 from the profiler UI, such as an unknown profile token, a missing EXPLAIN query or an asset outside the allowlist, no longer makes NestJS log "Content-Type doesn't match Reply body". These routes now set their HTML, CSS or JavaScript Content-Type only when they return a body, so the JSON error body goes out as `application/json`.
