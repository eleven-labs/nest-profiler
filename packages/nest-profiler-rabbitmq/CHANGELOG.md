# @eleven-labs/nest-profiler-rabbitmq

## 1.0.0-alpha.7

### Minor Changes

- 157436f: Push list filtering and pagination down to the storage adapter, add server-side pagination and a SQLite backend, and make list filters/sections declarative.

  `@eleven-labs/nest-profiler`:

  - **Server-side pagination**: each list section paginates independently via a `<sectionKey>_page` query param, with a Prev/Next pager. New `listPageSize` option (default `25`).
  - **Storage-level query pushdown**: new structured `ProfilerQuery` / `FilterCriterion` model and optional `query()` / `distinct()` methods on `IProfilerStorageAdapter`. `ProfilerStorageService` exposes `query()` / `distinct()` and, for adapters that don't implement them, falls back to an in-memory implementation over `findAll()` — so a query-capable store (a database, Redis…) can filter, sort, paginate and count natively instead of loading every profile. Exposes `ProfileSummary` / `summarizeProfile`, `applyQueryInMemory`, `selectPage`, `distinctFromSummaries`, `matchesCriterion` and `sectionTypeConstraint` to help build custom adapters.
  - **File storage**: the file adapter now filters/sorts/paginates over an in-memory `ProfileSummary` index persisted in a `_index.meta` sidecar, reading only the current page's `{token}.json` files; it implements the native `query()` / `distinct()` path.
  - **SQLite storage**: a new adapter under the `@eleven-labs/nest-profiler/sqlite` subpath (`better-sqlite3` as an optional peer dependency) stores each profile as an indexed summary row plus the full document and pushes queries down to SQL (`WHERE … ORDER BY … LIMIT/OFFSET` + `COUNT(*)`).
  - `maxProfiles` and `ttl` can now be **disabled** by passing `0` (or a negative value) — no cap / never expire — on every built-in adapter (the `100` / `3600` defaults are unchanged).
  - **BREAKING** — the list-filter and list-section extension API is now declarative so it can be pushed down:
    - `ProfilerListFilter.matches(profile, value)` is replaced by `toCriterion(value): FilterCriterion`; a dynamic `'select'`'s `optionsFor(profiles)` is replaced by `distinctField` (its options come from `storage.distinct()`).
    - `ProfilerListSection.matches(profile)` is removed; a section owns entrypoint `types` (defaulting to its `key`). `bucketProfilesBySection` and `ProfilerListSectionBucket` are removed in favour of `sectionTypeConstraint`.
    - `ProfilerEntrypointType` gains an optional `indexAttributes(profile)` projection so kind-specific facets are indexable and queryable.

  `@eleven-labs/nest-profiler-graphql`, `@eleven-labs/nest-profiler-rabbitmq`, `@eleven-labs/nest-profiler-commander`:

  - Migrate the contributed list filters to the declarative `toCriterion` API and add each entrypoint type's `indexAttributes` projection (GraphQL `operationType`; RabbitMQ `exchange` / `routingKey` / `handler` / `redelivered`; command `success`), so these scoped filters push down to query-capable storage adapters.

## 1.0.0-alpha.6

### Minor Changes

- 8516122: Add Symfony-style "copy" buttons to the profiler UI so captured operations can be replayed in one click.

  - `nest-profiler`: copy the incoming HTTP request as a runnable `curl` command, and copy each SQL query with its bound parameters inlined (supports both `$N` Postgres/TypeORM and `?` MySQL/MikroORM placeholders). Exposes `buildCurlCommand` and `interpolateSql`.
  - `nest-profiler-http`: copy each outgoing HTTP client request as `curl`.
  - `nest-profiler-mongoose`: copy each query as a runnable `mongosh` command; aggregation pipelines are now captured so `aggregate` copies are complete.
  - `nest-profiler-rabbitmq`: copy the message payload and a ready-to-run amqplib `channel.publish(...)` snippet.

## 1.0.0-alpha.5

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.4

### Minor Changes

- 13e53f8: New package: capture RabbitMQ messages consumed via `@RabbitSubscribe` (`@golevelup/nestjs-rabbitmq`).

  `RabbitMqCollectorModule.forRoot()` registers a context adapter for the `rmq` execution context that creates a fresh profile per consumed message with a `rabbitmq` entrypoint (`entrypoint.type = 'rabbitmq'`, the message details — exchange, routing key, handler, redelivered flag, AMQP tags, masked headers and payload — on `entrypoint.data`). The package owns its `RabbitMqInfo` type and `RABBITMQ_ENTRYPOINT_TYPE`, and registers a `rabbitmq` entrypoint type so messages render in their own **RabbitMQ** list table and on a built-in **Message** detail tab (the HTTP request/response tabs are hidden, like CLI commands). The list has its own filter bar — **Delivery** (first delivery / redelivered), **Exchange** and **Handler** (options built from the captured messages) and a free-text **Routing key** — while the HTTP-status filters are hidden, since a message has no HTTP response. Options: `enabled`, `captureHeaders`, `captureBody`, `maskHeaders`.
