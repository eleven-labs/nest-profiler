---
'@eleven-labs/nest-profiler': minor
---

Make the body-capture truncation limits fully configurable, and allow capturing an untruncated body.

The inner content caps applied to every captured request/response body (`maxStringLength`, `maxItems`, `maxDepth`) were hard-coded and never exposed, so `maxBodySize: 0` looked like it disabled truncation but the body content was still cut. They are now configurable via the new `bodyCaptureLimits` module option and threaded through the middleware and interceptor (request **and** response) to `normalizeBody` / `toSafeData`.

Each cap — including `maxBodySize` — can be disabled individually with `0` (or a negative value); disabling all of them captures the full body verbatim. Defaults are unchanged (64 KB / 2048 / 64 / 4), so behaviour is identical without opting in. The truncation marker's `_note` no longer claims the raw JSON export holds the full body, since the full body is never persisted — it now points at raising or disabling the caps instead.
