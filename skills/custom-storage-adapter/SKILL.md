---
name: custom-storage-adapter
description: |
  Implement a custom @eleven-labs/nest-profiler storage backend (Redis, a database, S3…) by implementing IProfilerStorageAdapter and wiring it via the `storage` option.
  Use when the built-in memory / file / sqlite backends don't fit — e.g. profiles must be shared across instances, survive deploys, or live in existing infrastructure.
---

# Write a custom storage adapter

The core ships three backends: `memory` (default), `file`, and `sqlite` (via `@eleven-labs/nest-profiler/sqlite`). Reach for a custom adapter when profiles must live elsewhere — Redis, Postgres/Mongo, S3 — typically to **share profiles across instances**, or to **persist where the local disk does not** (ephemeral/serverless filesystems, or across a redeploy that wipes the volume). Note: `file` and `sqlite` already survive a plain process restart on a box with a persistent disk — a custom adapter is only warranted when there is no such disk or the store must be shared/remote. Confirm the core is set up first (`setup-nest-profiler`).

## The contract — `IProfilerStorageAdapter`

Required methods: `save(profile)`, `findAll(options?)`, `findOne(token)`, `clear()`.

Important optionals:

- **`crossProcess`** (boolean) — set `true` for shared stores (Redis, DB, file). The commander/CLI profiler uses it to warn when command profiles land in a process-local store where the web UI can't see them. Omitted means "assume shared".
- **`query(query)`** — run the dashboard's structured list query (section + filters + sort + pagination) natively so a list render never loads every profile. Implement this for any store that can filter/paginate efficiently. When omitted, the service falls back to `findAll` + in-memory filtering (correct, not scalable).
- **`distinct(field, typeIn?)`** — distinct summary values for dynamic filter `select` options; falls back to deriving from `findAll`.
- **`setIndexAttributesProvider(provider)`** — called once at startup before the first save; needed if you persist a `ProfileSummary` for native `query`/`distinct` (to populate kind-specific `summary.attributes`).
- **`close()`** — release handles on shutdown (DB connection, file locks). Implement it for any native handle.

## Wire it via the `storage` option

`storage` takes precedence over `storageType`. Build the adapter (usually async, from `ConfigService`) and pass the instance:

```ts
ProfilerModule.forRootAsync({
  isGlobal: true,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    storage: new RedisStorageAdapter({
      url: config.get('redis.url'),
      ttl: config.get('profiler.ttl'),
    }),
  }),
});
```

Mirror the built-in `SqliteStorageAdapter` (in the core's `/sqlite` subpath) for shape, and `FileStorageAdapter` / `MemoryStorageAdapter` (both exported from `@eleven-labs/nest-profiler`) for the in-memory `query` fallback logic you may want to reuse.

## Verify

- Boot the app, make a few requests, and confirm profiles appear at `/_profiler` and survive a restart (persistent stores).
- Confirm the list page filters/paginates (exercise your `query`/`distinct` or the fallback).
- Confirm `close()` runs on shutdown without leaking a handle.

Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/storage>
