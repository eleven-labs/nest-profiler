---
'@eleven-labs/nest-profiler': minor
---

Make the profiler reliable under load and remove its latency overhead on profiled calls.

- File storage is now safe under concurrent traffic: index and disk mutations are serialized behind an internal mutex, the index can no longer hold duplicate entries, and profiles are written atomically (temp file + rename). Profiles created during a burst of parallel requests — e.g. chained GraphQL mutations — all show up in the `/_profiler` list instead of silently going missing.
- List rendering is much faster: parsed profiles are cached in memory and validated against each file's mtime, so a render costs one `stat` per profile instead of re-reading and parsing every JSON file. The cache is bounded by `maxProfiles` (memory grows with `maxProfiles × average profile size`); treat profiles returned by the storage as read-only.
- Collectors and storage writes now run **after** the response is sent, so profiling adds no measurable latency to HTTP, GraphQL or error responses. Only HTML responses still wait for the collectors so the injected toolbar can render its panels. Pending writes are drained on application shutdown. This supersedes the previous behavior where intercepted responses waited for the storage write.
- New `ProfilerService.flush()` awaits all in-flight profile persistence. Call it in automated tests before asserting on stored profiles; a client following `X-Debug-Token-Link` immediately after a response may otherwise hit a brief 404 window of a few milliseconds.
