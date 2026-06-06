---
'@eleven-labs/nest-profiler': patch
---

Fix the profiler list hiding every profile when a numeric filter received invalid input. Query params are now normalized through a dedicated, validation-library-agnostic pipe, so a bad value such as `?statusCode=abc` is ignored instead of producing a `NaN` filter that matched nothing.
