# @eleven-labs/nest-profiler-mikro-orm

## 1.0.0-alpha.12

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.11

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.10

### Patch Changes

- 1735b38: Document the `@alpha` install tag in every package README.

  - Install commands now pin `@eleven-labs/nest-profiler*` packages to the `@alpha` dist-tag, since there is no stable release yet (`@latest` resolves to nothing).
  - Added a short note next to each install snippet explaining the requirement.

## 1.0.0-alpha.9

### Minor Changes

- b7471e6: Make the severity of every threshold-based performance tag configurable per collector, and drive all severity colouring in the UI from the tag's actual severity.

  Each query/HTTP collector now accepts flat severity options alongside its thresholds: `slowSeverity`, `nPlusOneSeverity`, `chattySeverity`, `zeroRowsSeverity` (query collectors) and `slowSeverity`, `nPlusOneSeverity`, `chattySeverity`, `largePayloadSeverity` (HTTP). Each defaults to today's value (`slow`/`chatty`/`large-payload`/`zero-rows` → `warning`, `n-plus-one` → `danger`); `error` stays `danger` and is not configurable. `TagConfig` gains the matching optional fields.

  The dashboard now colours the query/HTTP panels consistently: the duration text, the "slow" sublabel, the summary "N slow" / "N N+1" counts, the row highlight and the badge pill all follow the tag's severity. Previously `slow` (a `warning`) was rendered red in the duration column and summary while its pill was amber; a missing `warning` background token also left the slow-row highlight invisible. New `warning` / `info` semantic colour tokens back this.

  Note: because colouring now follows severity, raising a tag's severity (e.g. `slowSeverity: 'danger'`) intentionally turns its duration text, counts, row highlight, pill and the performance banner red.

## 1.0.0-alpha.8

### Minor Changes

- 9b1d8a1: Public API and packaging cleanup before the stable release (breaking).

  - **GraphQL module renamed** for ecosystem consistency: `ProfilerGraphQLModule` → `GraphQLCollectorModule` and `ProfilerGraphQLModuleOptions` → `GraphQLCollectorModuleOptions` (all 11 other collectors already use `XxxCollectorModule`). No alias — update imports.
  - **`PROFILER_CONTEXT_ADAPTERS` removed** from the public API. It was never consumed by the core; the single supported way to register a context adapter is `ProfilerCoreService.registerContextAdapter(adapter)` from your module's `onModuleInit` (resolve the core with `moduleRef.get(ProfilerCoreService, { strict: false })`). The dead multi-token providers in the GraphQL and RabbitMQ modules are gone.
  - **Named ORM connections supported.** `TypeOrm`/`Mongoose`/`MikroOrm` collector options gain a `connectionName?: string`; the (optionally named) connection is injected by its resolved token, optionally, so a named-only setup no longer crashes at bootstrap and a missing connection warns instead. A `getRequest()` on context adapters lets the interceptor repose the transport request in CLS (fixes GraphQL requests showing as anonymous in the Security panel).
  - **Peer dependencies tightened.** The core peer on every collector is bounded (`>=1.0.0-alpha.7 <2.0.0`) instead of an unbounded `>=`. Optional peers (`axios`, `@golevelup/nestjs-rabbitmq`, `amqplib`, `@nestjs/graphql`, `class-validator`, `class-transformer`) are now declared in `peerDependencies` with ranges (plus `optional: true` in meta). `nest-profiler-http` no longer peer-depends on `@nestjs/axios` (it never imports it — you provide `axiosRef` via `forRootAsync`); `nest-profiler-commander` now declares `nest-commander` as a **required** peer (imported statically) rather than optional. ORM peer ranges widened to cover the installed base: `typeorm ">=0.3.20 <2.0.0"`, `mongoose "^8 || ^9"`. `nest-profiler-mikro-orm` requires Node `>=22.12.0` (stable `require(esm)`).
  - **Misc.** A throwing custom validator extractor can no longer turn a 400 into a 500; the RabbitMQ adapter's options are `@Optional()`; the dead `COMMANDER_COLLECTOR_OPTIONS` token is removed; the RabbitMQ package builds via the shared `repo-build`. `@golevelup/nestjs-rabbitmq` is now a dev dependency.

- 00c971a: Capture streaming reads (TypeORM `stream()`, Mongoose `cursor()`, MikroORM `stream()`) that previously bypassed or under-reported in the query collectors.

  - `nest-profiler`: add an optional `streaming` flag to `QueryEntry` and render a `stream` badge in the SQL panel; streaming reads whose duration could not be measured are labelled `not timed (stream)` in the Duration column.
  - `nest-profiler-typeorm`: wrap `QueryRunner.stream()` alongside `query()`. Duration is measured non-intrusively from the stream's terminal `end`/`close`/`error` events — no `data` listener, so no rows are diverted from the caller; entries are flagged `streaming: true`. Streamed row counts are not captured.
  - `nest-profiler-mongoose`: patch `Query.cursor()` and `Aggregate.cursor()`, which bypass `exec()`. The read is recorded at cursor creation (flagged `streaming: true`) so it is captured whatever the consumption pattern; duration is finalized from terminal events for flowing / `pipe()` / explicit `close()`, and stays `0` for `for await` / `eachAsync()` (which emit no terminal event) — a documented limitation.
  - `nest-profiler-mikro-orm`: detect streaming reads (a `SELECT` logged without `took`) and flag them `streaming: true`. Their `duration` stays `0` since MikroORM logs the query before consuming rows; measuring it would require wrapping the internal row generator.

- 882e5ac: Add `forRootAsync` to every collector whose options are resolved at runtime, so masking, thresholds and capture flags can be driven from `ConfigService` (or any provider) instead of static literals.

  - New `forRootAsync({ imports?, inject?, useFactory })` on `TypeOrmCollectorModule`, `MongooseCollectorModule`, `MikroOrmCollectorModule`, `ConfigCollectorModule`, `AuthCollectorModule`, `RabbitMqCollectorModule` and `ValidatorCollectorModule`, mirroring the existing `HttpCollectorModule.forRootAsync`. Each package also exports a matching `*CollectorModuleAsyncOptions` type.
  - Collectors now share a `ConfigurableModuleBuilder`-based options token and a single `buildCollectorModule` helper (exported from `@eleven-labs/nest-profiler`) that centralizes the synchronous `enabled: false` short-circuit — so disabling behaves consistently across every collector.
  - `enabled` stays a synchronous build-time flag (it decides which providers are registered, which an async factory cannot); per-environment gating remains the host's job via `ConditionalModule.registerWhen(...)`. `HttpCollectorModule` is refactored onto the shared builder with no change to its public API (`HTTP_COLLECTOR_OPTIONS`, `HTTP_INSTRUMENTATIONS`, `axios`/`instrumentations` and the `axiosRef` contract are preserved).
  - `cache`, `commander` and `graphql` are intentionally left `forRoot`-only: their sole option is `enabled`, which has nothing to resolve asynchronously.

- ffa4d9a: Detect performance anti-patterns (N+1, slow, error, chatty, large-payload) across SQL, Mongo and outgoing HTTP with a rule-based tagging engine.

  The core now runs a single analysis pass (`analyzeProfile`) once per profile — after every collector, before persistence — that groups entries on a collector-supplied `fingerprint` and applies `PerformanceRule`s, attaching structured `ProfilerTag[]` (`{ id, label, severity, count?, detail? }`) to each entry and aggregating them onto `profile.tags`. Built-in rules: `slow`, `n-plus-one` (the N+1 anti-pattern), `error`, `chatty` and `large-payload` (HTTP). Contribute your own via `ProfilerModule.forRoot({ performance: { rules: [...] } })` or `ProfilerCoreService.registerPerformanceRule()`; the emitted tag ids become filterable.

  Tags surface as coloured pills on each query/HTTP row and in the panel headers; the detail page shows a prominent **Performance** banner listing the issues and colour-codes the affected collector's nav tab by severity (the tab badge stays a plain count). On the list page, tags render as pills and a new **Performance tag** filter (Slow / N+1 / Chatty / Large payload, plus any custom id via `registerFilterOption('tag', …)`) plus a separate **With errors** checkbox replace the former **With exceptions** checkbox (errors are failures, not performance issues; the checkbox is broader — it covers failed HTTP/query calls too). The SQLite adapter gains an indexed `tags` column.

  **Breaking changes**

  - The per-query `isSlow` boolean is removed from `QueryEntry`, `MongooseQueryEntry` and the Mongo entry shape; "slow" is now the `slow` tag, computed centrally by the engine (no longer at capture time). Read it from `entry.tags` (or `profile.tags`).
  - Each collector's `slowQueryThreshold` option is renamed to `slowThreshold`, and gains sibling options `nPlusOneThreshold` (default 2) and `chattyThreshold` (default 20; `10` for HTTP). The HTTP collector additionally gains `slowThreshold` (default 300 ms) and `largePayloadThreshold` (default 1 MB).
  - The built-in `hasExceptions` list filter is removed in favour of the generic `tag` filter.

- 102ec76: Capture the row count and connection metadata of every database query, and flag silent zero-row writes.

  - `nest-profiler`: add optional `rowCount`, `connection` (`host:port`, no credentials) and `database` to `QueryEntry`; the SQL panel renders a per-query metadata line (`42 rows @ localhost:5432 / shop`) and a "rows read" total in the header. A new built-in `zero-rows` performance rule tags a SQL `UPDATE`/`DELETE` with `rowCount === 0` (and a Mongoose `delete`/`update` with `count === 0`) as a silent failure — it surfaces as an amber pill, highlights the row, colours the Database tab and is selectable in the list page's performance-tag filter. Empty reads and writes whose row count could not be captured are never flagged.
  - `nest-profiler-typeorm`: derive `rowCount` best-effort from the driver result (array length, or `affected`/`rowCount`/`affectedRows`/`changes`) without altering it; read `connection`/`database` once from the DataSource options (omitted for drivers with no host/port, e.g. sqlite). Streamed reads still capture no row count.
  - `nest-profiler-mikro-orm`: capture `rowCount` from the log context (`affected` for writes, `results` for reads) and `connection`/`database` from the ORM config (`host`/`port`/`dbName`), falling back to the log context's connection name.
  - `nest-profiler-mongoose`: expose `connection`/`database` from the mongoose Connection on every captured operation; the existing `count` (documents returned/affected) drives the zero-row parity for `delete`/`update` writes.

- 9b1d8a1: Reliability fixes across the profiler.

  - **Correct HTTP error status.** A non-`HttpException` thrown from a handler is now recorded as `500` instead of a stale `200`, matching the non-HTTP path.
  - **Disabling the profiler no longer removes validation.** `ValidatorCollectorModule.forRoot({ enabled: false })` still installs the bare validation pipe (your `pipe` or the default class-validator one), just without profiling.
  - **GraphQL filters fixed.** `ignoreGraphQLIntrospection` no longer misclassifies the ubiquitous `__typename` meta-field as introspection (it matched `__type`), so real traffic is profiled again. `ignoreGraphQLPlayground` is now scoped to the GraphQL endpoint path (default `/graphql`, configurable via the new `createIgnoreGraphQLPlayground(path)`), so it no longer suppresses every HTML page of a mixed SSR + GraphQL app.
  - **Mongoose writes are captured.** `document.save()` / `Model.create()`, `insertMany()` and `bulkWrite()` now appear in the MongoDB panel (previously only `Query`/`Aggregate` reads were visible).
  - **Disabled core no longer crashes collectors.** Collectors resolve the core's global providers (`ClsService`, `ProfilerCoreService`, the ORM connection) lazily via `ModuleRef.get(token, { strict: false })` in `onModuleInit` and degrade to a no-op when they are absent, so `ProfilerModule.forRoot({ enabled: false })` / `ProfilerNoopModule` with a collector left enabled boots cleanly instead of failing DI. (A plain `@Optional()` dependency does not traverse to a global module from a dynamic feature module, so it could not be used here.) The HTTP `HttpProfilerRecorder` stays injectable (no-op) when disabled.
  - **Dashboard performance.** The list page fetches only the 30 most-recent profiles for the heap trend (bounded `query()`), instead of loading and parsing the whole store — restoring the SQLite pushdown benefit on its own hot path.
  - **Persistence failures are logged** (previously swallowed silently). Bodies/log payloads with circular references or `BigInt` no longer crash the detail page or persistence (defensive serialization), and captured bodies are size-bounded via the new `maxBodySize` option.
  - **Robustness.** A failing custom HTTP instrumentation no longer aborts app bootstrap; a storage failure during a profiled CLI command no longer masks the command's own error.
  - **Asset cache-busting.** Profiler asset URLs carry a `?v=<version>` query so a package upgrade doesn't serve stale CSS/JS from browser/proxy caches.

- 31c0423: Add a global "Schema" panel per ORM listing the registered entities and their columns, relations and indexes.

  - `nest-profiler`: add a shared `AbstractSchemaCollector` (global-scope, introspects once at bootstrap and caches) plus the normalized `EntitySchema`/`ColumnInfo`/`RelationInfo`/`IndexInfo` types and a single `schema-panel.ejs` rendering one collapsible section per entity — mirroring the `AbstractSqlQueryCollector` + shared `sql-panel.ejs` trajectory. Column defaults are passed through `redactString`, and an empty introspection despite a present ORM handle emits a diagnosable `Logger.warn` canary.
  - `nest-profiler-typeorm`: add `TypeOrmSchemaCollectorModule` — introspects `dataSource.entityMetadatas` (columns, relations, indices), honours `connectionName`, and no-ops when no DataSource is wired or initialized.
  - `nest-profiler-mikro-orm`: add `MikroOrmSchemaCollectorModule` — introspects `orm.getMetadata().getAll()` (props, relations, indexes/uniques), honours `connectionName`, and no-ops when no context is wired.
  - `nest-profiler-mongoose`: add `MongooseSchemaCollectorModule` — introspects each model's `schema.paths` and `schema.indexes()` (fields, `ref` relations, indexes), honours `connectionName`, and no-ops when no connection is wired.

- 9b1d8a1: Harden data capture and access control.

  - **Secret redaction everywhere.** A shared redaction utility (`redact`, exported from the core) now masks sensitive object keys (`password`, `token`, `apiKey`, DSN…) and credentials embedded in string values (URL userinfo `user:pass@`, JWTs, `sk-`/`pk-` keys, PEM blocks). It is applied to request headers (`maskHeaders`, default sensitive list — including the raw `cookie` header), config values (DSNs whose key is not itself sensitive, e.g. `DATABASE_URL`), the `@nestjs/config` `_PROCESS_ENV_VALIDATED` firehose is now dropped, SQL parameters (TypeORM/MikroORM), Mongo filters/pipelines, validator rejected values, RabbitMQ payloads, CLI arguments/options, session data, JWT claims and the auth user (now redacted recursively). The redaction sentinel is unified to `[REDACTED]`.
  - **`captureRequestBody` now defaults to `false`** (symmetry with `captureResponseBody`); captured bodies are redacted.
  - **No path traversal / token collisions.** The storage token is always an internal UUID; the client `x-request-id` header is kept only as a display-only `requestId` attribute. The file storage adapter additionally rejects any non-`[A-Za-z0-9_-]` token.
  - **Browser-usable access control.** `ProfilerGuard` now accepts the token via a `?token=` query parameter (not only `Authorization: Bearer`), exempts static assets under `__assets/*`, and compares tokens in constant time. Configuring a token no longer breaks the UI or the injected toolbar.
  - **Security headers** (`Cache-Control: no-store`, strict CSP, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`) on the HTML pages and the JSON export; the `X-Debug-Token` headers can be disabled with `emitDebugHeaders: false`.

### Patch Changes

- c86de8b: Hoist a shared `AbstractQueryCollector` and harden the multi-ORM Database panel.

  - New ORM-agnostic `AbstractQueryCollector<TEntry>` in the core barrel owns the shared `Nq (M slow)` badge and the collect flow (drain the private `queriesKey`, delete it, then run a `transform` hook). `AbstractSqlQueryCollector` now only pins the SQL panel template; `MongooseCollector` drops its hand-rolled `getBadgeValue`/`collect` and keeps just its `queriesKey`, template path, and a `transform` override (attaching the runnable mongo `command`).
  - The TypeORM and MikroORM collectors now expose distinct panel labels (`TypeORM` / `MikroORM`) instead of a shared `SQL`, so their sub-tabs stay identifiable when several ORMs share the **Database** group (e.g. TypeORM + Mongoose in the same app). No change when a single SQL ORM is used.

- 9b1d8a1: Minor correctness and robustness fixes.

  - **Storage query parity** between the in-memory/file and SQLite backends: `contains` is now case-insensitive on both sides; LIKE wildcards (`%`, `_`) in a filter value are escaped (no false positives); results have a deterministic `token` tie-breaker so pagination is stable across equal timestamps; an empty `typeIn` consistently means "no type constraint".
  - **Memory adapter** no longer evicts the oldest profile when re-saving an existing token (e.g. the GraphQL backfill), which previously shrank the store below its cap.
  - **Storage lifecycle**: adapters may implement `close()`; the profiler calls it on shutdown after a **bounded** drain of pending saves (so a hung custom adapter can't block graceful shutdown), and the SQLite handle is closed/checkpointed.
  - **Route matching** escapes regex metacharacters and supports param constraints (`:id(\\d+)`) without throwing, and compiles each pattern once instead of per request.
  - **Cache collector** records failed cache operations (with an `error`) instead of dropping them, and restores the patched methods on module destroy.
  - **Robustness**: the config panel warns when it reads empty despite a `ConfigService` (canary on the private `internalConfig`); MikroORM re-evaluates the host's query-logging setting per call and surfaces the real error message; the `mongosh` copy command uses safe serialization; the HTTP-request detail template guards missing `query`/`headers`; the client copy button tolerates malformed base64 and escapes group ids with `CSS.escape`; interpolated SQL escapes backslashes.

## 1.0.0-alpha.7

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.6

### Patch Changes

- d34fefe: Update supported peer dependency ranges and test dependencies for current NestJS 11-compatible releases, including `nestjs-cls` 6, Mongoose 9, and TypeORM 1.

## 1.0.0-alpha.5

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.4

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.3

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.2

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.1

### Patch Changes

- Updated dependencies [e4822c6]
  - @eleven-labs/nest-profiler@1.0.0-alpha.1

## 0.5.1-alpha.0

### Patch Changes

- ff89de2: First public npm (alpha) release. `@eleven-labs/nest-profiler-mikro-orm` is the MikroORM query collector for `@eleven-labs/nest-profiler`:
  - Captures SQL queries in the **Database** panel via the MikroORM logger, reusing the core `AbstractSqlQueryCollector` rendering contract (query type, SQL text, duration).
  - Idempotent instrumentation (`__profilerPatched`) so queries are never recorded twice.
  - Ships as **ESM-only** (`"type": "module"`), matching `@mikro-orm/core` and `@mikro-orm/nestjs` v7 (also ESM-only) — it must be consumed from an ESM host (CJS consumers use a dynamic `import()`).
  - `enabled` option (no-op providers when `false`) and `MikroOrmCollectorModule.forRoot()` configuration.

- Updated dependencies [ff89de2]
  - @eleven-labs/nest-profiler@0.5.1-alpha.0
