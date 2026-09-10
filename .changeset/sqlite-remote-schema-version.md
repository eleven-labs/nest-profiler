---
'@eleven-labs/nest-profiler': patch
---

Fix `SqliteStorageAdapter` failing to open a remote libSQL database: the schema version is now recorded in a `profiler_meta` table instead of the `user_version` pragma, which hosted libSQL servers (Turso) reject over the remote protocol with `SQL_PARSE_ERROR`. Existing stores are recreated once on open, as for any schema version change.
