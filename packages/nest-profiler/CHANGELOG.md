# @eleven-labs/nest-profiler

## 1.0.0-alpha.12

### Minor Changes

- c74556d: Decouple log capture from `ProfilerService`: `createProfilerLogger` is now the single, DI-free way to capture logs.

  `createProfilerLogger(delegate, options?)` no longer takes a `ProfilerService` argument — it resolves the active profile statically from the process-wide CLS store, exactly like `createProfilerValidationPipe`. Build it anywhere (typically in `main.ts`) and pass it to `app.useLogger(...)` with no `app.get(ProfilerService)`:

  ```ts
  import { createProfilerLogger } from '@eleven-labs/nest-profiler';

  app.useLogger(createProfilerLogger(new ConsoleLogger('App')));
  ```

  With no active profile (profiler disabled, bootstrap, or a background job) it is a transparent pass-through, so no log line is ever lost.

  **Breaking changes:**

  - `ProfilerService.createLogger(...)` is removed — use the standalone `createProfilerLogger(delegate, options?)`.
  - `ProfilerService.addLog(...)` is removed — capture logs by wrapping your logger with `createProfilerLogger` instead.
  - `createProfilerLogger`'s second parameter is now the options object directly (`createProfilerLogger(delegate, options)`), not a `ProfilerService`.

  Because the logger no longer resolves `ProfilerService`, `ProfilerNoopModule` is only needed when your app injects `ProfilerService` directly (`startSpan`, `addEvent`, `addException`, `setSecurityContext`, `getCurrentToken`). Apps that only capture logs and rely on collectors can drop the no-op fallback entirely.

- 762e132: Trim the `ProfilerService` public API down to what earns its place.

  `ProfilerService` now exposes only `startSpan`, `getCurrentToken` and `flush`. The manual enrichment methods have been removed because they duplicated automatic capture or had no consumer:

  - **`addException`** — exceptions are already captured automatically by the exception filter and the interceptor, so `profile.exceptions` is populated without it.
  - **`setSecurityContext`** — the security context is already set automatically by `@eleven-labs/nest-profiler-auth`, so `profile.security` is populated without it.
  - **`addEvent`** — the events feature had no producer and was rendered nowhere. The method, the `EventEntry` type, the `profile.events` field and the `EventEntry` export are all removed.

  **Breaking changes:**

  - Removed `ProfilerService.addException`, `ProfilerService.addEvent` and `ProfilerService.setSecurityContext` (and their `NoopProfilerService` counterparts).
  - Removed the `EventEntry` type export and the `Profile.events` field.

  Custom timeline instrumentation still lives on `ProfilerService.startSpan(...)`; exceptions and the security panel keep working through their automatic capture.

### Patch Changes

- bd9255b: Capture the response body of error responses written by an exception filter.

  - On the `catchError` path the interceptor finalizes `profile.response` before the exception filter produces the body, so `response.body` was left `undefined` while successful responses captured theirs. The finish hook then bailed out because `profile.response` was already set, dropping the payload the client actually received.
  - The middleware finish hook now backfills `response.body` from the intercepted `res.json/send/end` output when the profile carries an exception, its body is still `undefined`, and `collectBody` is enabled — symmetrical to the existing GraphQL envelope backfill. The success path and the response status code are left untouched.

- 300aaf8: Serialize non-plain values meaningfully in `redact()` instead of collapsing them.

  - `redact()` (used for SQL parameters, request/response bodies, config snapshots, …) enumerated any object's own-enumerable string keys, so a `Date` became `{}`, a `Buffer` became a byte-index map, and `Map`/`Set`/`URL`/`RegExp`/`Error` became `{}`. A `BigInt` passed through unchanged and then threw `Do not know how to serialize a BigInt` when the profile was `JSON.stringify`-d for storage.
  - Well-known types are now serialized before the plain-object branch: `Date` → ISO string, `Map` → object (keys stringified, sensitive keys still masked), `Set` → array, `URL`/`RegExp` → string, `Error` → `{ name, message, stack }`, `ArrayBuffer`/`Buffer`/TypedArray → a `[<Type> <n> bytes]` placeholder, and `BigInt` → its decimal string so serialization never throws.
  - Remaining class instances prefer their `toJSON()` projection when present, else fall back to own-enumerable enumeration as before.
  - `isPlainObject` is now strict (prototype must be `Object.prototype` or `null`), so exotic objects are no longer property-enumerated by any consumer.

## 1.0.0-alpha.11

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.10

### Patch Changes

- 1735b38: Document the `@alpha` install tag in every package README.

  - Install commands now pin `@eleven-labs/nest-profiler*` packages to the `@alpha` dist-tag, since there is no stable release yet (`@latest` resolves to nothing).
  - Added a short note next to each install snippet explaining the requirement.

- 05a5adb: Keep the profiler UI reachable at `/_profiler` under a host app's routing.

  `/_profiler` was the mount point _and_ the value hardcoded into every link pointing at it, so any routing transform the host applied to its own controllers moved the UI while its links stayed behind. The profiler is tooling, not part of the API surface, so it now stays at `/_profiler` whatever the app does — with nothing for the consumer to declare.

  - **URI versioning made the UI unreachable.** `ProfilerController` was a plain `@Controller()`, so it inherited the app's `defaultVersion`: with `enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })` the whole UI moved to `/v1/_profiler` and `GET /_profiler` returned `404`. The controller is now `VERSION_NEUTRAL` — no version scheme (URI, header or media-type) applies to it, and your own routes keep their versions.
  - **A global prefix moved the UI and broke its links.** `setGlobalPrefix('api/v1')` pushed the profiler to `/api/v1/_profiler` while its rendered asset/navigation links, the injected toolbar and the `X-Debug-Token-Link` header still pointed at `/_profiler` — a page with no styles and dead links. The profiler now opts itself out of the global prefix, so it stays at `/_profiler` and everything pointing at it stays correct. Listing `_profiler` in your own `exclude` is no longer needed (and won't double up if you keep it).

  Documented under [Configuration → Versioning and global prefix](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration).

## 1.0.0-alpha.9

### Major Changes

- 6ce7e47: Define what counts as an **error**, per package (breaking).

  "Error" had one hardcoded meaning: any status ≥ 400, plus any captured exception, always `danger`. But a `404` is a bug for one team and an ordinary answer for another, and a status code means nothing to GraphQL, RabbitMQ or a CLI command. Each entrypoint kind now carries its own definition, and you can redefine it — the `error` tag, its pills and the list's **Errors** checkbox all follow. See [What counts as an error](https://nestjs-profiler-module.vercel.app/en/docs/packages/nest-profiler/error-classification).

  **BREAKING — 4xx are no longer errors.** The default is now a status ≥ 500, or a captured exception when no status was recorded. Profiles previously tagged `error` for a `401`/`403`/`404` no longer are, and the **Errors** checkbox no longer keeps them. Restore the old behaviour with `ProfilerModule.forRoot({ error: { httpStatus: 400 } })`. The same shift applies to **outgoing HTTP calls** (`@eleven-labs/nest-profiler-http`): a call is failed when it threw or answered ≥ 500 — restore with `HttpCollectorModule.forRoot({ error: { httpStatus: 400 } })`.

  The layers resolve in order, first decisive: `classify` (tri-state — return `undefined` to defer) → `httpStatus`, which when a status is present decides **on its own** → `exceptions`, the fallback for kinds without a status. Layer 2 being decisive is what keeps the defaults coherent: a `NotFoundException` produces both an exception and a `404`, so consulting the exceptions too would contradict the status and re-flag the very 404 you excluded.

  - **`@eleven-labs/nest-profiler`** — new `error` option on `ProfilerModule.forRoot()` governing the built-in `http` kind. `ProfilerEntrypointType` gains `isError`/`errorSeverity` (a kind's verdict) and `hiddenFilters` (universal filters it drops from its list). `TagConfig` gains `isErrorEntry`/`errorSeverity`, so `error` is finally severity-configurable like the five other built-in tags. New exports: `resolveProfileErrorClassifier`, `resolveEntryErrorClassifier`, `resolveErrorSeverity`, `buildHttpEntrypointType`, and the `ProfilerErrorOptions`/`EntryErrorOptions`/`ProfileErrorInfo` types. `analyzeProfile()` takes an optional 4th argument carrying the kind's verdict (existing calls keep working; without it, only entries can be errors).
  - **New `Exception` list filter** — narrows to one failure type, with options built from the values actually captured (no configuration). It complements the **Errors** checkbox rather than duplicating it: `Errors` asks "what failed, per my definition", `Exception` asks "show me the `NotFoundException`s", whether or not they count as failures. Backed by a new universal `exception` index attribute (the primary exception's code, else its class name).
  - **`@eleven-labs/nest-profiler-graphql`** — new `error` option. A GraphQL response is `200` even when the operation failed, so statuses are ignored and `extensions.code` takes their role: only `INTERNAL_SERVER_ERROR` counts by default, plus errors carrying no code. `BAD_USER_INPUT`/`UNAUTHENTICATED`/`NOT_FOUND` are the schema answering correctly. **BREAKING:** `GraphQLCollectorModuleOptions` moved to a dedicated entrypoint (still exported from the package root) and the module now follows the `ConfigurableModuleBuilder` pattern of every other collector, gaining `forRootAsync()`. `ExceptionEntry` gains `code`, populated from `extensions.code` instead of being buried in the `stack` string.
  - **`@eleven-labs/nest-profiler-rabbitmq`** — new `error` option. A message has no status, so the default is "the handler threw"; narrow it with `error: { exceptions: ['TimeoutError'] }` when a handler throws as flow control.
  - **`@eleven-labs/nest-profiler-commander`** — a non-zero exit is a failure, and that needs no configuration. The Commands list now hides the **Errors** checkbox, its `Status: Success/Failed` filter already asking exactly that.
  - The **Errors** checkbox was labelled `With errors`; it is now `Errors`, aligned with the other filter labels (`Status`, `Method`, `Exception`). The query parameter (`<section>_error`) is unchanged.

### Minor Changes

- b7471e6: Make the severity of every threshold-based performance tag configurable per collector, and drive all severity colouring in the UI from the tag's actual severity.

  Each query/HTTP collector now accepts flat severity options alongside its thresholds: `slowSeverity`, `nPlusOneSeverity`, `chattySeverity`, `zeroRowsSeverity` (query collectors) and `slowSeverity`, `nPlusOneSeverity`, `chattySeverity`, `largePayloadSeverity` (HTTP). Each defaults to today's value (`slow`/`chatty`/`large-payload`/`zero-rows` → `warning`, `n-plus-one` → `danger`); `error` stays `danger` and is not configurable. `TagConfig` gains the matching optional fields.

  The dashboard now colours the query/HTTP panels consistently: the duration text, the "slow" sublabel, the summary "N slow" / "N N+1" counts, the row highlight and the badge pill all follow the tag's severity. Previously `slow` (a `warning`) was rendered red in the duration column and summary while its pill was amber; a missing `warning` background token also left the slow-row highlight invisible. New `warning` / `info` semantic colour tokens back this.

  Note: because colouring now follows severity, raising a tag's severity (e.g. `slowSeverity: 'danger'`) intentionally turns its duration text, counts, row highlight, pill and the performance banner red.

- 9541773: Add a pluggable `security` option to protect the profiler UI/API, so consumers can enforce **any** authentication (or none — the profiler is **open by default**).

  - `security.authorize` — a `(ctx) => boolean | Promise<boolean>` predicate over the platform-agnostic `request`/`response` (set a `WWW-Authenticate` header for a Basic challenge). Covers token, Basic, cookie/session, custom header, external calls…
  - `security.guards` — one or more NestJS `CanActivate` guards (a class resolved through DI, or a ready instance) to reuse an existing app guard.
  - `security.linkQuery` — threads a query-param credential (`?token=`) across the UI links so query-param schemes survive browser navigation (cookies/sessions/Basic auth propagate natively).

  Providing several strategies requires **all** to pass; providing none keeps the profiler open. Static assets stay exempt. The JSON export link and UI navigation carry the visitor's credential. New exports: `ProfilerSecurityOptions`, `ProfilerAuthorize`, `ProfilerAuthContext`, `ProfilerGuard`, `PlatformRequest`, `PlatformResponse`.

- a3ba8ee: Rework the profiler home page into a two-column, sidebar-navigated layout.

  The home page (`GET /_profiler`) now uses the detail page's two-column layout — a sticky left sidebar of **views** and a right content pane — with the active view selected server-side from a `?view=` query parameter (plain links, no client JS, consistent with the `script-src 'self'` CSP).

  Each entrypoint kind is its own dissociated page under a **Profiling** group: the sidebar lists HTTP, GraphQL, Commands, RabbitMQ… as sub-items (defaulting to the HTTP catch-all), and each renders only its own list section, filters, pager and the process-heap trend. Every global-scope collector (Config, Routes, Schemas…) is a view too. Every sidebar item carries a **count badge** — a list section shows its unfiltered profile total, and a global panel shows its own count (taken by convention from the first `*Count` field its data exposes, e.g. `routeCount`). `GlobalPanelInfo` gains an optional `badge` computed by `CollectorRegistry.buildGlobalPanels()`.

  Each list section renders an **empty-state row** when it has no profiles (every kind is now always reachable as its own page), the detail page gains a **back link** to the list view of the profile's kind (e.g. back to the GraphQL list from a GraphQL profile), and the now-redundant "All Profiles" header link is dropped (the sidebar covers navigation).

  The two-column layout is responsive: it stacks to a single column on small screens (the sidebar moves to the top, full-width) and becomes the sticky two-column layout from `md` up — applied identically to the home page and the profile detail page so both read as one system on mobile.

### Patch Changes

- a3ba8ee: Make the profiler-UI tables horizontally scrollable on narrow/mobile viewports (fixes #184).

  Every list-section table (HTTP, GraphQL, Command, RabbitMQ) and several collector-panel tables (schema, timeline, routes, cache, validator) were wrapped in an `overflow-hidden` container (there to clip the rounded corners), which also clipped horizontal overflow with no scrollbar — so on a phone the wide tables were squished and the right-hand columns became unreachable. Each wide table now sits in an `overflow-x-auto` container with a sensible `min-w`, so a table too wide to fit scrolls horizontally within its own card (rounded corners preserved) while the page body itself never scrolls sideways.

## 1.0.0-alpha.8

### Major Changes

- 9b1d8a1: Public API and packaging cleanup before the stable release (breaking).

  - **GraphQL module renamed** for ecosystem consistency: `ProfilerGraphQLModule` → `GraphQLCollectorModule` and `ProfilerGraphQLModuleOptions` → `GraphQLCollectorModuleOptions` (all 11 other collectors already use `XxxCollectorModule`). No alias — update imports.
  - **`PROFILER_CONTEXT_ADAPTERS` removed** from the public API. It was never consumed by the core; the single supported way to register a context adapter is `ProfilerCoreService.registerContextAdapter(adapter)` from your module's `onModuleInit` (resolve the core with `moduleRef.get(ProfilerCoreService, { strict: false })`). The dead multi-token providers in the GraphQL and RabbitMQ modules are gone.
  - **Named ORM connections supported.** `TypeOrm`/`Mongoose`/`MikroOrm` collector options gain a `connectionName?: string`; the (optionally named) connection is injected by its resolved token, optionally, so a named-only setup no longer crashes at bootstrap and a missing connection warns instead. A `getRequest()` on context adapters lets the interceptor repose the transport request in CLS (fixes GraphQL requests showing as anonymous in the Security panel).
  - **Peer dependencies tightened.** The core peer on every collector is bounded (`>=1.0.0-alpha.7 <2.0.0`) instead of an unbounded `>=`. Optional peers (`axios`, `@golevelup/nestjs-rabbitmq`, `amqplib`, `@nestjs/graphql`, `class-validator`, `class-transformer`) are now declared in `peerDependencies` with ranges (plus `optional: true` in meta). `nest-profiler-http` no longer peer-depends on `@nestjs/axios` (it never imports it — you provide `axiosRef` via `forRootAsync`); `nest-profiler-commander` now declares `nest-commander` as a **required** peer (imported statically) rather than optional. ORM peer ranges widened to cover the installed base: `typeorm ">=0.3.20 <2.0.0"`, `mongoose "^8 || ^9"`. `nest-profiler-mikro-orm` requires Node `>=22.12.0` (stable `require(esm)`).
  - **Misc.** A throwing custom validator extractor can no longer turn a 400 into a 500; the RabbitMQ adapter's options are `@Optional()`; the dead `COMMANDER_COLLECTOR_OPTIONS` token is removed; the RabbitMQ package builds via the shared `repo-build`. `@golevelup/nestjs-rabbitmq` is now a dev dependency.

- ffa4d9a: Detect performance anti-patterns (N+1, slow, error, chatty, large-payload) across SQL, Mongo and outgoing HTTP with a rule-based tagging engine.

  The core now runs a single analysis pass (`analyzeProfile`) once per profile — after every collector, before persistence — that groups entries on a collector-supplied `fingerprint` and applies `PerformanceRule`s, attaching structured `ProfilerTag[]` (`{ id, label, severity, count?, detail? }`) to each entry and aggregating them onto `profile.tags`. Built-in rules: `slow`, `n-plus-one` (the N+1 anti-pattern), `error`, `chatty` and `large-payload` (HTTP). Contribute your own via `ProfilerModule.forRoot({ performance: { rules: [...] } })` or `ProfilerCoreService.registerPerformanceRule()`; the emitted tag ids become filterable.

  Tags surface as coloured pills on each query/HTTP row and in the panel headers; the detail page shows a prominent **Performance** banner listing the issues and colour-codes the affected collector's nav tab by severity (the tab badge stays a plain count). On the list page, tags render as pills and a new **Performance tag** filter (Slow / N+1 / Chatty / Large payload, plus any custom id via `registerFilterOption('tag', …)`) plus a separate **With errors** checkbox replace the former **With exceptions** checkbox (errors are failures, not performance issues; the checkbox is broader — it covers failed HTTP/query calls too). The SQLite adapter gains an indexed `tags` column.

  **Breaking changes**

  - The per-query `isSlow` boolean is removed from `QueryEntry`, `MongooseQueryEntry` and the Mongo entry shape; "slow" is now the `slow` tag, computed centrally by the engine (no longer at capture time). Read it from `entry.tags` (or `profile.tags`).
  - Each collector's `slowQueryThreshold` option is renamed to `slowThreshold`, and gains sibling options `nPlusOneThreshold` (default 2) and `chattyThreshold` (default 20; `10` for HTTP). The HTTP collector additionally gains `slowThreshold` (default 300 ms) and `largePayloadThreshold` (default 1 MB).
  - The built-in `hasExceptions` list filter is removed in favour of the generic `tag` filter.

### Minor Changes

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

- c86de8b: Hoist a shared `AbstractQueryCollector` and harden the multi-ORM Database panel.

  - New ORM-agnostic `AbstractQueryCollector<TEntry>` in the core barrel owns the shared `Nq (M slow)` badge and the collect flow (drain the private `queriesKey`, delete it, then run a `transform` hook). `AbstractSqlQueryCollector` now only pins the SQL panel template; `MongooseCollector` drops its hand-rolled `getBadgeValue`/`collect` and keeps just its `queriesKey`, template path, and a `transform` override (attaching the runnable mongo `command`).
  - The TypeORM and MikroORM collectors now expose distinct panel labels (`TypeORM` / `MikroORM`) instead of a shared `SQL`, so their sub-tabs stay identifiable when several ORMs share the **Database** group (e.g. TypeORM + Mongoose in the same app). No change when a single SQL ORM is used.

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

- a8a149b: Show which REST routes are protected by a guard in the Routes panel.

  Each route now surfaces the guard classes applied via `@UseGuards()` on its controller and/or handler (e.g. an authentication guard): guarded routes show a lock, and expanding a route lists its guards. The core `RouteEntry` type gains an optional `guards?: string[]` field, and the routes package exports a `readRouteGuards()` helper. Only route-level guards are reflected — a global `APP_GUARD` is not attached per handler.

- a8a149b: New package: a **Routes** panel for the profiler home page — a Symfony-Routing-style view of the application's routing table.

  `RoutesCollectorModule.forRoot()` contributes a global-scope panel listing every registered route grouped by transport. It ships a built-in **REST** source that discovers request-mapped handlers at startup and, per route, introspects the path params (from the route path), query params and headers (from `@Query`/`@Headers`), and the `@Body()` DTO — its class name, top-level decorated properties, TypeScript types and (when `class-validator` is installed, an optional peer) the validation rules. Other transport packages contribute their own group by registering a `ProfilerRouteSource` with the core.

  The core now exposes the route-source extension point consumed by the panel: the `ProfilerRouteSource` / `RouteGroup` / `RouteEntry` / `RouteInputs` types, `ProfilerCoreService.registerRouteSource()` / `getRouteSources()`, and the shared `scanHttpRoutes()` route-discovery helper (also used internally by the request-to-handler matcher). Fixes a latent double-slash bug in route path construction (`@Get('/_profiler')` now yields `/_profiler` instead of `//_profiler`).

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

- 79a2373: Harden the SQLite storage backend for cheaper saves and a more resilient open path.

  - **Memoized prepared statements**: every query is compiled once per SQL shape and reused, instead of re-preparing (notably the per-save `INSERT`) on every call.
  - **Counter-derived eviction**: an in-memory row count (kept exact across re-saves, re-synced from `COUNT(*)` to absorb writes by another process) gates trimming, so a save no longer sorts the whole table below the cap. The TTL sweep is amortized — reads already enforce the TTL — while the overflow trim stays synchronous and only fires once actually over `maxProfiles`.
  - **Resilient open path**: open failures are wrapped in an actionable, `cause`-chained error naming the resolved path. New `onCorruption: 'recreate' | 'throw'` option (default `'recreate'`) moves a corrupt file aside to `<path>.corrupt-<timestamp>` (sidecars included) and starts fresh, or rethrows.
  - **New `busyTimeout` option** (default `5000` ms) tunes how long a write waits on a concurrent writer of the same file database.

### Patch Changes

- 54abcec: Collect GraphQL field-resolver queries.

  Over HTTP, GraphQL collection was finalized when the root resolver returned — before graphql-js runs field resolvers — so any database query issued in a `@ResolveField` was drained too early and never appeared in the collector panels (the classic N+1 stayed invisible). The middleware now marks the profile once its response-finish listener is registered, and the non-HTTP interceptor path defers `collectAll()` to that hook, which fires after every field resolver. Genuine non-HTTP transports (no finish hook) keep collecting inline as before.

- 9b1d8a1: Fix two release blockers.

  - **http**: the package no longer references `@nestjs/axios` at all (no import, no lazy `require`). Installing `@eleven-labs/nest-profiler-http` never touches the peer, so a "bring your own client" (fetch/undici/got) setup can't crash at import. To instrument axios you now hand the collector your `HttpService.axiosRef` via `HttpCollectorModule.forRootAsync({ inject: [HttpService], useFactory: (http) => ({ axiosRef: http.axiosRef }) })`; the axios adapter no-ops when no `axiosRef` is provided.
  - **core**: the injected toolbar now loads a dedicated, preflight-free stylesheet (`toolbar.css`) scoped under `#profiler-toolbar`, instead of the full `profiler.css`. Tailwind's universal preflight reset is no longer applied to profiled host pages, so enabling the toolbar no longer breaks the host application's layout.

- 9b1d8a1: Minor correctness and robustness fixes.

  - **Storage query parity** between the in-memory/file and SQLite backends: `contains` is now case-insensitive on both sides; LIKE wildcards (`%`, `_`) in a filter value are escaped (no false positives); results have a deterministic `token` tie-breaker so pagination is stable across equal timestamps; an empty `typeIn` consistently means "no type constraint".
  - **Memory adapter** no longer evicts the oldest profile when re-saving an existing token (e.g. the GraphQL backfill), which previously shrank the store below its cap.
  - **Storage lifecycle**: adapters may implement `close()`; the profiler calls it on shutdown after a **bounded** drain of pending saves (so a hung custom adapter can't block graceful shutdown), and the SQLite handle is closed/checkpointed.
  - **Route matching** escapes regex metacharacters and supports param constraints (`:id(\\d+)`) without throwing, and compiles each pattern once instead of per request.
  - **Cache collector** records failed cache operations (with an `error`) instead of dropping them, and restores the patched methods on module destroy.
  - **Robustness**: the config panel warns when it reads empty despite a `ConfigService` (canary on the private `internalConfig`); MikroORM re-evaluates the host's query-logging setting per call and surfaces the real error message; the `mongosh` copy command uses safe serialization; the HTTP-request detail template guards missing `query`/`headers`; the client copy button tolerates malformed base64 and escapes group ids with `CSS.escape`; interpolated SQL escapes backslashes.

## 1.0.0-alpha.7

### Minor Changes

- e5464e6: Ship the profiler UI's browser behaviour as compiled, same-origin JavaScript bundles instead of inline template scripts, and make the client layer extensible.

  - All authored client behaviour (theme toggle, syntax highlighting, copy-to-clipboard, filter forms, tab switching) now lives in TypeScript, is bundled at build time, and is served under `/_profiler/__assets/scripts/*`. The HTML templates carry no inline `<script>` blocks and no `on*` attributes, so a strict `script-src 'self'` Content-Security-Policy works out of the box.
  - New `window.NestProfiler` browser runtime (`onReady`, `delegate`, `copyText`, `highlight`) that other bundles reuse — the only cross-bundle contract.
  - New `ClientAssetRegistry` service (exported, with `CORE_CLIENT_SCRIPT` and the `ClientAssetRegistration` type): a package shipping its own collector can register a client bundle so the profiler serves it and injects its `<script>` after `profiler.js`.
  - `nest-profiler-http`: the HTTP Client panel's request-row expand/collapse behaviour moves out of inline template handlers into a compiled `http.js` bundle registered automatically via `ClientAssetRegistry` — a reference implementation of the pattern. No consumer-facing change.

- c68c375: Add `ProfilerNoopModule` and `NoopProfilerService` — a zero-dependency no-op path for when the profiler is disabled. Pair `ProfilerNoopModule` with `ConditionalModule.registerWhen` as the fallback so `ProfilerService` stays injectable everywhere and consumers never fail with "cannot resolve dependency ProfilerService":

  ```ts
  ConditionalModule.registerWhen(ProfilerModule.forRootAsync({ isGlobal: true, ... }), isProfilerEnabled),
  ConditionalModule.registerWhen(ProfilerNoopModule.forRoot({ isGlobal: true }), (env) => !isProfilerEnabled(env)),
  ```

  `NoopProfilerService` implements the full `ProfilerService` public API but injects nothing (no `ClsService`, no core), so the disabled path has no runtime cost. The core module's inert (`enabled: false`) layer now binds `ProfilerService` to it too — the disabled path no longer imports `ClsModule` nor runs the async options factory.

  `ConditionalModule` is now the recommended way to enable/disable profiling; the top-level `enabled` option remains fully supported as the alternative.

  Remove the non-functional `path` option from `ProfilerModuleOptions`: the profiler UI is always mounted at `/_profiler` (the controller routes and middleware are fixed), so a custom `path` produced a broken UI. The base path is now the internal `PROFILER_BASE_PATH` constant.

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

### Patch Changes

- 0903d1a: Keep detail-page navigation items active when they carry content but expose no counter, instead of dimming them like disabled tabs.

  Entrypoint tabs (Request/Response, GraphQL, Command, Message) have no badge function, and grouped collector panels may lack a counter too. Both paths coerced the absent badge to `null`, which the sidebar treats as "no data" and dims. The badge is now kept `undefined` in those cases (only an explicit `null` from `getBadgeValue`/`badge` still means "no data"), so tabs and groups that always have content render active.

## 1.0.0-alpha.6

### Minor Changes

- 8516122: Add Symfony-style "copy" buttons to the profiler UI so captured operations can be replayed in one click.

  - `nest-profiler`: copy the incoming HTTP request as a runnable `curl` command, and copy each SQL query with its bound parameters inlined (supports both `$N` Postgres/TypeORM and `?` MySQL/MikroORM placeholders). Exposes `buildCurlCommand` and `interpolateSql`.
  - `nest-profiler-http`: copy each outgoing HTTP client request as `curl`.
  - `nest-profiler-mongoose`: copy each query as a runnable `mongosh` command; aggregation pipelines are now captured so `aggregate` copies are complete.
  - `nest-profiler-rabbitmq`: copy the message payload and a ready-to-run amqplib `channel.publish(...)` snippet.

### Patch Changes

- d34fefe: Update supported peer dependency ranges and test dependencies for current NestJS 11-compatible releases, including `nestjs-cls` 6, Mongoose 9, and TypeORM 1.

## 1.0.0-alpha.5

### Patch Changes

- 89356b8: Self-host the profiler UI assets instead of loading them from external CDNs. Tailwind CSS is now compiled to a static stylesheet at build time and highlight.js is vendored locally; both are served same-origin under `/_profiler/__assets/*` with immutable caching. This removes the production-unsafe browser Tailwind runtime, drops all third-party CDN requests, and lets the toolbar style itself on host pages.

## 1.0.0-alpha.4

### Minor Changes

- 9523bad: Make the kind of thing a profile describes — an HTTP request, a CLI command, a consumed message… — a first-class, extensible **entrypoint type**, so a package can add a new kind (its own list table, detail tab, scoped list filters and breadcrumb summary) in a single call without touching the core.
  - New discriminated profile model: `Profile.entrypoint = { type, data }` replaces the overloaded `Profile.request`. HTTP/GraphQL data moves to `entrypoint.data` (the renamed `HttpRequestData`); `RequestData` is removed.
  - New `ProfilerCoreService.registerEntrypointType()` plus the `ProfilerEntrypointType`, `ProfilerDetailTab` and `EntrypointSummary` contracts (and the `PROFILER_ENTRYPOINT_TYPES` token). The controller resolves the detail tabs, list section and breadcrumb summary from the active entrypoint type — the hard-coded per-kind branching is gone.
  - The core now ships only the built-in `http` entrypoint type for REST requests; `CommandInfo` and the Commands table/tab move to `@eleven-labs/nest-profiler-commander`, GraphQL becomes its own `graphql` type in `@eleven-labs/nest-profiler-graphql`, and further entrypoint kinds live in their own packages. Each kind's list has its own filter bar (universal filters plus the kind's scoped filters via `listFilters`); there is no longer a global `type` filter.
  - Collector `scope: 'request'` is renamed to `scope: 'profile'` to reflect that profile-scoped collectors (database, cache, HTTP client…) attach to **any** entrypoint, not just HTTP requests. `'profile'` is the default, so collectors that don't set a scope are unaffected.
  - Every list section now renders inside a collapsible `<details>`/`<summary>` disclosure (bordered card with a hoverable header, matching the global panels): the summary keeps the title and count badge visible while the table and filter bar fold away. Sections are expanded by default; a section (or an entrypoint type's `listSection`) can set `defaultCollapsed: true` to start folded.

## 1.0.0-alpha.3

### Minor Changes

- 65697f4: Capture structured log context and show it in the Logs tab.
  - `createLogger()` now understands the three common call conventions: NestJS (`log(message, context)`, including the `error(message, stack, context)` contract), pino / nestjs-pino `PinoLogger` (`info(mergingObject, message)` — merging object first) and the message-first style `log(message, payloadObject)`. Structured payloads land in the new `LogEntry.data` field; `LogEntry.context` keeps holding the logger context name. Printf interpolation arguments (`%s`-style tokens) and stack-shaped strings are never mistaken for a context name.
  - When the call arguments carry no context name, the adapter falls back to the delegate's own `context` property — a directly-injected `PinoLogger` (`@InjectPinoLogger(MyService.name)`) finally shows its context in the profiler.
  - `Error` arguments are serialized as `{ name, message, stack }` and every payload is made JSON-safe before storage (circular references, `BigInt`, `Date`, `Map`/`Set`, depth/size/string-length caps), so a profile can no longer fail to persist because of a log payload.
  - The Logs tab now shows the Message column before Context and renders `data` as a pretty-printed JSON block under the message.
  - `createLogger(delegate, options)` accepts `{ logMethods, parseArgs }` to override which methods are intercepted and how arguments are classified; passing a plain `LogMethodMap` as before keeps working. The default parser is exported as `parseLogArgs`.

## 1.0.0-alpha.2

### Minor Changes

- 2522a29: Make the profiler reliable under load and remove its latency overhead on profiled calls.
  - File storage is now safe under concurrent traffic: index and disk mutations are serialized behind an internal mutex, the index can no longer hold duplicate entries, and profiles are written atomically (temp file + rename). Profiles created during a burst of parallel requests — e.g. chained GraphQL mutations — all show up in the `/_profiler` list instead of silently going missing.
  - List rendering is much faster: parsed profiles are cached in memory and validated against each file's mtime, so a render costs one `stat` per profile instead of re-reading and parsing every JSON file. The cache is bounded by `maxProfiles` (memory grows with `maxProfiles × average profile size`); treat profiles returned by the storage as read-only.
  - Collectors and storage writes now run **after** the response is sent, so profiling adds no measurable latency to HTTP, GraphQL or error responses. Only HTML responses still wait for the collectors so the injected toolbar can render its panels. Pending writes are drained on application shutdown. This supersedes the previous behavior where intercepted responses waited for the storage write.
  - New `ProfilerService.flush()` awaits all in-flight profile persistence. Call it in automated tests before asserting on stored profiles; a client following `X-Debug-Token-Link` immediately after a response may otherwise hit a brief 404 window of a few milliseconds.

### Patch Changes

- 423e67a: Add subresource integrity to profiler CDN assets and pin the browser Tailwind runtime to an exact version.
- 59d7b6c: Capture exceptions thrown by guards (and anything running before the interceptor) in the profile's Exceptions tab.

  Guards run before interceptors in the NestJS lifecycle, so `ProfilerInterceptor.catchError` never saw exceptions such as an auth guard's `UnauthorizedException`: the 401 profile recorded the right status and security context but its `exceptions` array stayed empty. A new global `ProfilerExceptionFilter` (registered only in the enabled layer) observes the exception on its way out and records it on the active profile, then delegates to `BaseExceptionFilter` so the framework's default response formatting is preserved. Only HTTP requests are touched — GraphQL/RPC errors remain handled by the interceptor.

## 1.0.0-alpha.1

### Minor Changes

- e4822c6: Make the profiler list filters extensible and add request-type filtering plus default ignore paths.

  `@eleven-labs/nest-profiler`:
  - New extensible filter system: filters are now `ProfilerListFilter` definitions (key, label, control, `parse`, `matches`) registered via `ProfilerCoreService.registerListFilter()` or the `PROFILER_LIST_FILTERS` multi-token. Packages can also add options to an existing `select` filter via `ProfilerCoreService.registerFilterOption()`. The list-page form renders everything dynamically.
  - New built-in filters: request **type** (HTTP / Command), **status class** (2xx/3xx/4xx/5xx), a **With exceptions** checkbox, and a **global search** (URL + GraphQL operation name + command name) replacing the previous "URL contains" field. Filters now apply to the commands table too, and selecting the `command` type hides the HTTP/GraphQL table.
  - Default ignore paths: `/favicon.ico`, `/robots.txt`, `/.well-known/appspecific/com.chrome.devtools.json` and `/apple-touch-icon*` are skipped by default; opt out with the new `useDefaultIgnorePaths: false` option.
  - List filtering now runs in the controller over `storage.findAll()`; custom storage adapters no longer receive the list query as `StorageFindOptions` (the `findAll(options)` signature is unchanged for direct callers).

  `@eleven-labs/nest-profiler-graphql`:
  - Adds a **GraphQL** option to the profiler list `type` filter when the module is registered.

## 0.5.1-alpha.0

### Patch Changes

- ff89de2: First public release on the npm registry, shipped as an alpha prerelease with build provenance. Install with `pnpm add @eleven-labs/nest-profiler@alpha`.

  `@eleven-labs/nest-profiler` is a NestJS web profiler inspired by Symfony's Web Profiler. It provides:
  - Per-request profiling with a unique token (UUID v4) and a floating debug toolbar injected into HTML responses.
  - A built-in profiler UI at `/_profiler`: profile list, detail view, filters, and JSON export.
  - Built-in panels: **Request**, **Response**, **Performance**, **Timeline** (`startSpan()` / `stop()` API), **Logs**, and **Exceptions**.
  - An extensible collector architecture via the `@ProfilerCollector()` decorator and the `IProfilerCollector` interface, with collector grouping (a shared sidebar tab via a `group` key).
  - A context-adapter extension point (`IContextAdapter`, `PROFILER_CONTEXT_ADAPTERS`, `PROFILER_REQ_KEY`, `ProfilerCoreService`) for profiling non-HTTP contexts (GraphQL, gRPC, WebSockets, …).
  - Request filtering: `ignorePaths`, a custom `ignoreRequest` predicate, and the `combineFilters` OR-combinator.
  - Logger-agnostic log capture via `createProfilerLogger` (a transparent `Proxy` wrapping any logger), with `DEFAULT_LOG_METHODS` and a customizable `LogMethodMap`.
  - CLI command profiles (`request.command` / `CommandInfo`): a dedicated **Commands** table and **Command** tab (consumed by `@eleven-labs/nest-profiler-commander`).
  - A shared `AbstractSqlQueryCollector` base (with `QueryEntry` / `QueryType` / `detectQueryType`) for SQL ORM collectors.
  - Two storage backends — in-memory LRU (default) and file-based (`FileStorageAdapter`, cross-process aware) — plus custom storage via `IProfilerStorageAdapter`.
  - A per-collector timeout (`collectorTimeout`, default `1000`ms) so a slow collector can never block the response, and resilient collection that surfaces collector errors instead of hiding them.
  - A token-secured UI (`token` option or `PROFILER_TOKEN`) and debug headers (`X-Debug-Token`, `X-Debug-Token-Link`, `X-Profiler-Token`).
  - `ProfilerModule.forRoot()` / `forRootAsync()` configuration (`enabled`, `path`, `maxProfiles`, `ttl`, `isGlobal`, `storageType`, `storagePath`, `storage`, `collectBody`, `sampleRate`, `ignorePaths`, `ignoreRequest`, `maskCookies`, `collectorTimeout`, `token`).
  - Platform-agnostic support for both `@nestjs/platform-express` and `@nestjs/platform-fastify`.
