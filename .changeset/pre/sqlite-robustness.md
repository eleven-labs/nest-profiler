---
'@eleven-labs/nest-profiler': minor
---

Back the SQLite storage adapter with `@libsql/client` so one adapter serves a local file, an ephemeral `:memory:` database, or a **remote SQLite database** (`url` + optional `authToken`) — ideal for serverless hosts, with no second adapter.

- **`@libsql/client` optional peer dependency** replaces `better-sqlite3`; memory/file users still pull nothing extra (the core never imports the driver).
- **New `url` / `authToken` options** point the adapter at a remote SQLite database and take precedence over `path`. `path` (local file, parent directory auto-created) and `':memory:'` keep working; a local file stays cross-process via WAL.
- **BREAKING** — `SqliteStorageAdapter` is now fully async: `save` / `findOne` / `findAll` / `query` / `distinct` / `clear` / `close` return promises. The `IProfilerStorageAdapter` contract already allowed this and the profiler awaits them, so only code calling the adapter directly needs to `await`.
- **BREAKING** — removed the `better-sqlite3`-specific `busyTimeout` and `onCorruption` options (and the corrupt-file move-aside path); they have no `@libsql/client` equivalent.
- **Counter-derived eviction** is preserved: an in-memory row count (kept exact across re-saves, re-synced from `COUNT(*)` to absorb writes by another process) gates trimming, so a save never sorts the whole table below the cap; the TTL sweep stays amortized.
