---
'@eleven-labs/nest-profiler': patch
---

Record the payload actually sent to the client when a route handler returns the response object. Controllers using `@Res()` with `return res.json(payload)` emit the Express response itself (`res.json()` returns `res`), which the interceptor stored as the response body — the profiler's Response tab showed the serialized `ServerResponse` (its `req`, sockets and raw headers) instead of the payload. The interceptor now detects that value and falls back to the body the middleware captured off `res.json()` / `res.send()`; the response-finish hook also backfills any body written after the observable completed (e.g. `res.render()`).
