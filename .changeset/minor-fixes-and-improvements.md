---
'@eleven-labs/nest-profiler': patch
'@eleven-labs/nest-profiler-cache': patch
'@eleven-labs/nest-profiler-config': patch
'@eleven-labs/nest-profiler-mikro-orm': patch
'@eleven-labs/nest-profiler-mongoose': patch
---

Minor correctness and robustness fixes.

- **Storage query parity** between the in-memory/file and SQLite backends: `contains` is now case-insensitive on both sides; LIKE wildcards (`%`, `_`) in a filter value are escaped (no false positives); results have a deterministic `token` tie-breaker so pagination is stable across equal timestamps; an empty `typeIn` consistently means "no type constraint".
- **Memory adapter** no longer evicts the oldest profile when re-saving an existing token (e.g. the GraphQL backfill), which previously shrank the store below its cap.
- **Storage lifecycle**: adapters may implement `close()`; the profiler calls it on shutdown after a **bounded** drain of pending saves (so a hung custom adapter can't block graceful shutdown), and the SQLite handle is closed/checkpointed.
- **Route matching** escapes regex metacharacters and supports param constraints (`:id(\\d+)`) without throwing, and compiles each pattern once instead of per request.
- **Cache collector** records failed cache operations (with an `error`) instead of dropping them, and restores the patched methods on module destroy.
- **Robustness**: the config panel warns when it reads empty despite a `ConfigService` (canary on the private `internalConfig`); MikroORM re-evaluates the host's query-logging setting per call and surfaces the real error message; the `mongosh` copy command uses safe serialization; the HTTP-request detail template guards missing `query`/`headers`; the client copy button tolerates malformed base64 and escapes group ids with `CSS.escape`; interpolated SQL escapes backslashes.
