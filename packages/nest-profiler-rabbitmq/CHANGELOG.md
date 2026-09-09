# @eleven-labs/nest-profiler-rabbitmq

## 1.0.0-alpha.18

### Major Changes

- 5ea9463: BREAKING: replace `ProfilerService` with `TracerService`, and reduce spans to a single model.

  - `TracerService` replaces `ProfilerService` and `NoopProfilerService`, which are removed with no alias. It injects only optional dependencies, so the same class is the documented no-op when the profiler is disabled — there is no second implementation to keep in sync.
  - `@Span(name?)` records a whole method as one span without touching its body — same nesting and error marking as `span()`, but one line, no re-indentation, and `return` keeps meaning "return from the method". It needs no injection: like `createProfilerLogger`, it resolves the active profile from the CLS store. The name defaults to `ClassName.methodName`.
  - `span(name, work)` runs the work inside a span, closes it however it ends, and marks it failed when it throws. Work issued underneath reports it as its parent through the CLS store, so nesting is exact rather than inferred from overlapping time windows.
  - `startSpan(name)` now returns a `TraceSpanDelegate` carrying `end()`, `setTag()` and `addTags()` instead of a close function.
  - `captureError(error, tags?)` records an error the application caught itself, marked `handled` so a request that recovered is not counted as a failure.
  - `setAttribute()` / `getAttribute()` write to `Profile.attributes`, so a value set from application code is indexed and filterable from the profile list.
  - `Profile.trace` replaces `Profile.spans`: one flat, `parentId`-linked `TraceSpan` list assembled by `buildTrace()` after collection. `TimelineSpan`, `LifecyclePhase` and `Profile.lifecycle` are removed; lifecycle phases are spans with `lane: 'lifecycle'`.
  - `Profile.traceId` replaces `HttpRequestData.requestId` and applies to every entrypoint kind. It adopts the `traceIdHeader` (default `x-request-id`) when the caller sent a usable value, and is length- and charset-validated before adoption, since it reaches log lines, the dashboard and outgoing headers.
  - New options `traceIdHeader` and `attachTraceIdToLogs` (default `true`); `createProfilerLogger` prefixes forwarded messages with the trace id and stamps `LogEntry.spanId`.
  - The RabbitMQ adapter adopts the message's `correlationId` as the trace id, linking a consumed message to the request that published it.

### Minor Changes

- e374e09: Drop the Token column from every profile list, lead with Time and Duration, and make the whole row the link.

  - The **Token** column is gone from the HTTP, GraphQL, Commands and RabbitMQ lists: the token identifies the profile in the URL, in the `X-Debug-Token` header and on the detail page, so repeating a truncated copy on every row only pushed the columns that discriminate one execution from another out of the way.
  - Every list now opens on **Time** then **Duration** — when an execution happened and what it cost — before the columns specific to its kind.
  - The detail tables follow the same order: SQL queries, Mongoose queries, HTTP client calls, cache operations and the execution timeline all lead with Time then Duration, so a table reads the same wherever it sits.
  - The row is the link: no cell owns it any more. A new `row-link` client behaviour navigates on a click anywhere in a `[data-row-href]` row, opens a new tab on ctrl/meta or middle click, and follows a focused row on `Enter`. Nested interactive elements and clicks that end a text selection are left alone.
  - Custom list sections: put the profile URL in `data-row-href` on the `<tr>` and add `tabindex="0"` (a `<tr>` is not focusable on its own) to get the same behaviour.
  - The attribute is validated before it is followed: only a same-origin path navigates, never a `javascript:`, protocol-relative or cross-origin value.

- e1ab2bf: Unify redaction configuration, annotate exceptions with source code frames, add custom indexed attributes, and round out the sampling/tracing options with `alwaysProfile`, `debug` and `version`.

  - New `redaction` block on `ProfilerModule.forRoot()` — `{ useDefaults, headers, cookies, queryParams, keys, patterns, replacement }` — replacing the scattered `maskHeaders`/`maskCookies`/`maskQueryParams`/`useDefaultMask*` options with a single, additive configuration surface. The old flat options still work (merged additively with `redaction` when both are set) but are deprecated and will be removed in a future major version.
  - `redact()`/`redactString()` (`@eleven-labs/nest-profiler`) gain `patterns` (extra value regexes) and a configurable `replacement` sentinel, plus a Luhn-validated card-number detector so a 13-19 digit run is only masked when it passes the checksum — an ordinary numeric id of the same length is left alone.
  - New shared `RedactionKeyOptions`/`RedactionHeaderOptions`/`RedactionQueryParamOptions` interfaces exported from the core, adopted by `nest-profiler-config`, `nest-profiler-http` and `nest-profiler-rabbitmq` instead of redeclaring the same fields.
  - Fixed a real drift in `nest-profiler-rabbitmq`: its default masked-header list had only 4 of the core's 6 entries (missing `set-cookie` and `proxy-authorization`). It now reuses the core's list directly.
  - New `sourceContext` option (`boolean | { linesOfContext, maxFrames }`): attaches a source-code excerpt to every captured exception's application stack frames, rendered in the Exceptions tab for the primary exception and each `cause`. Hardened against a forged `Error#stack`: only files under `process.cwd()` with a recognised extension are read, reads are cached (failures too, bounded), and it never throws.
  - New `attributes` option (a plain object, or a per-HTTP-request function) attaching custom indexed facets to a profile, merged into `ProfilerCoreService.getIndexAttributes()` and queryable as `attributes.<key>` the same way the built-in `exception` facet already is.
  - New `version` option stamped on every profile and shown in its header — useful once profiles outlive a deploy (`storageType: 'file'`, SQLite).
  - New `alwaysProfile` option: force-captures a request past the `sampleRate` roll (still subject to `ignoreRequest`/`ignorePaths`, which remain a hard "never profile this").
  - New `debug` option: traces via `Logger.debug` why a request was or wasn't profiled (the profiler's own route, `ignoreRequest`, `ignorePaths`, or the `sampleRate` roll).
  - Fixed: **response headers were never masked**, so a `set-cookie` — a replayable session for as long as the profile lives — was stored and rendered in the clear. Responses now mask on the same list as requests.
  - Fixed: **captured bodies were never redacted**. With `collectBody: true`, a login request body kept its `password` in the clear. Request and response bodies now go through `redact()` with the configured options, applied after the `bodyCaptureLimits` / `maxBodySize` caps.
  - `version` and `sourceContext` now reach every entrypoint, not just HTTP: `version` is stamped on the way to storage, and `@eleven-labs/nest-profiler-commander` annotates a failed command's stack frames on the core's setting.
  - A caller-supplied `redaction.patterns` entry is applied globally even without the `g` flag (it previously masked only the first match), sticky patterns no longer carry `lastIndex` across calls, and a `replacement` containing `$&`/`$1` is written literally instead of being interpolated.

### Patch Changes

- ec8aad8: Consolidate three sets of internals that had been copied across the workspace, and record exception causes.

  **Reading the active profile.** `readProfile`, `readToken`, `readRequest` and `setProfileContext` are the way to reach the profiling context. The CLS store was previously addressed by string literal in 24 places across ten packages, each with its own `try`/`catch` — and `PROFILER_CLS_KEYS`, which existed precisely to prevent that, was used almost nowhere. A mistyped key reads as `undefined` rather than failing, silently turning a collector into a no-op; the accessors remove the opportunity. `PROFILER_CLS_KEYS` also gains the `token` key it was missing while three packages wrote the literal.

  **Exception causes and codes.** `toExceptionEntry` replaces the four hand-rolled constructions of an `ExceptionEntry` (the interceptor's HTTP and non-HTTP paths, the catch-all exception filter, the command profiler), which had all drifted into recording only `name`, `message` and `stack`. Two things are now captured:

  - **`ExceptionEntry.cause`** — the `cause` chain of a wrapped error, recorded recursively to a bounded depth and cycle-safe. An `InternalServerErrorException` says nothing; the `QueryFailedError` underneath says everything. The Exceptions tab renders the chain as one `Caused by` block per level.
  - **`ExceptionEntry.code`** — a machine-readable code carried by the error (`ENOENT`, `ECONNREFUSED`, a driver's own), which the `exception` list filter groups by in preference to the class name.

  Coercion of a non-`Error` throw is deliberately unchanged, so existing profiles keep grouping under `Error`.

  **Shared collector options.** `CollectorModuleOptions` (the `enabled` flag, previously redeclared in twelve interfaces) and `TagSeverityOptions` (the tag severities, redeclared in five) are declared once in the core and extended by each collector's options interface. Only options whose meaning _and_ default are identical everywhere moved: the numeric thresholds stay per package, because a slow SQL query is 100 ms, a slow outgoing HTTP call 300 ms and a slow publish 50 ms — that default is the useful half of the documentation.

  No behaviour change and no configuration change: every option keeps its name, type and default, and the accessors return exactly what the code they replace returned.

- ce21258: Measure every duration on a monotonic clock, with sub-millisecond resolution.

  Elapsed time — the request duration and every timeline span — was computed from `Date.now()`, which is both millisecond-granular and non-monotonic. Two consequences: any span shorter than a millisecond reported `0ms`, which is most application work and made the execution timeline unusable for comparing phases; and a wall-clock adjustment mid-request (an NTP step) produced a wrong duration, a backward step a **negative** one, which then flowed into the `slow` performance rule, the duration list filter and the stored profile summary.

  - `PerformanceData.duration` and `TimelineSpan.duration` are now measured with `performance.now()` and carry up to three decimals (`0.42`, `1.618`). They are clamped at `0`, so a duration can never be negative.
  - Absolute timestamps are unchanged and stay on the wall clock, because they are what a reader needs: `performance.startTime`, `TimelineSpan.startedAt`, `createdAt` and every log/exception timestamp remain epoch milliseconds.
  - The HTTP middleware now reads the clock **once**: `createdAt` and `performance.startTime` named the same instant through two separate `Date.now()` calls and could disagree by a millisecond.
  - New `formatDuration` view helper, applied to every duration the UI renders (profile header and Performance tab, the execution timeline, and the HTTP / GraphQL / Command / RabbitMQ list and detail views). It trades precision against magnitude — two decimals below 10 ms, one below 100 ms, whole milliseconds above — trims trailing zeros, and renders `<0.01` for a value too small to show rather than a misleading `0`.
  - New exports: `monotonicNow`, `elapsedMs`, `markProfileStart`, `profileElapsedMs`, `formatDuration`. A package contributing its own entrypoint kind calls `markProfileStart(profile)` when it builds the profile to opt into monotonic measurement; a kind that does not falls back to the wall-clock difference, clamped at zero.

  No migration and no storage change: SQLite's numeric affinity preserves a fractional value in the existing `duration INTEGER` summary column, on existing databases as well as new ones (covered by a test).

  Anything reading `performance.duration` or `span.duration` programmatically — a custom performance rule, a custom collector panel, an assertion in a test — now receives a fractional number where it used to receive an integer.

## 1.0.0-alpha.17

### Major Changes

- 46a05ab: Name the Discover contract after **Discover**, and RabbitMQ after **RabbitMQ**.

  Two naming inconsistencies had survived the move to per-transport Discover views. The extension point was still called `Route*` while three of its four sources contribute no routes at all — a CLI command, a GraphQL field and a message handler are not routes — and the publish panel was labelled **AMQP** next to a **RabbitMQ** list section, a **RabbitMQ** detail tab and a **RabbitMQ** Discover view, so one broker carried two names.

  Discover contract (core, and every source implementing it):

  - `ProfilerRouteSource` → `ProfilerDiscoverSource`, `RouteGroup` → `DiscoverGroup`, `RouteEntry` → `DiscoverEntry`, `RouteInputs` / `RouteInputGroup` / `RouteInputItem` → `DiscoverInputs` / `DiscoverInputGroup` / `DiscoverInputItem`, `RouteDtoInfo` / `RouteDtoProperty` → `DiscoverDtoInfo` / `DiscoverDtoProperty`.
  - `ProfilerCoreService.registerRouteSource()` → `registerDiscoverSource()`, `getRouteSources()` → `getDiscoverSources()`.
  - `DiscoverGroup.routes` → `DiscoverGroup.entries`, and `RoutesCollectorData.routeCount` → `entryCount`.
  - The shipped sources follow: `HttpRouteSource` → `HttpDiscoverSource`, `GraphqlRouteSource` → `GraphqlDiscoverSource`, `RabbitMqRouteSource` → `RabbitMqDiscoverSource`, `CommanderRouteSource` → `CommanderDiscoverSource`.

  `@eleven-labs/nest-profiler-routes`, `RoutesCollectorModule` and `RoutesCollector` keep their names — the package still ships the built-in HTTP source and owns the panel — as does `RouteCollector`, the core's HTTP route matcher, which is unrelated to Discover.

  RabbitMQ naming:

  - The publish panel is labelled **RabbitMQ** instead of **AMQP**, and its rule domain is `rabbitmq` instead of `amqp`, so a chatty profile reads `12 rabbitmq calls in one request`. The core's per-domain defaults (`chattyThreshold`, the N+1 subject) move with it.
  - `AmqpPublishEntry` → `RabbitMqPublishEntry`. Internals follow suit (`AmqpPublishPatch` → `RabbitMqPublishPatch`, `buildAmqpPublish` → `buildRabbitMqPublish`), and the remaining prose says "RabbitMQ" where it used to say "AMQP", keeping the term only where it names the wire protocol itself.

  BREAKING: every renamed symbol above is a published export. No behaviour changes — a consumer importing one updates the import name, and a custom `ProfilerDiscoverSource` renames its `routes` field to `entries`. Nothing in the `?view=` keys, the storage format or the module options changes.

### Minor Changes

- 46a05ab: Report the whole RabbitMQ surface in **Discover / RabbitMQ**, not just a one-line locator per handler.

  The view listed one row per `@RabbitSubscribe` with its `exchange → routingKey` and nothing else, which is the least interesting half of a broker setup: the dead-letter exchange a queue routes to, the retry queue that TTLs back into it, the exchanges an application only publishes to and the connection a handler actually runs on were all invisible. The RabbitMQ source now reports both halves, read from the resolved `RabbitMQModule` configuration — no management-API call, no extra credentials, and it stays accurate while the broker is unreachable.

  - **The declared topology**, as sections above the handler list: **Connections** (broker URI with credentials masked, prefetch, channels, handler configs), **Exchanges** (type, durability flags, arguments), **Queues** (the binding that feeds each one, its flags and its `x-…` arguments) and **Exchange bindings** (with their pattern). Queues nothing subscribes to — dead-letter, retry, delay — are listed too, since they carry the flow even though no handler names them.
  - **The full subscription** per handler, the way a CLI command documents its arguments and options: **Subscription** (`queue`, `exchange`, `routingKey`, `connection`, module-level `handler config`, `channel`), **Bindings** (multi-exchange `bindings`), **Queue options** (`queueOptions` with `arguments` spread one `x-…` key per row) and **Behaviour** (`allowNonJsonMessages`, `errorBehavior`, `batchOptions`, a custom `deserializer`, …).
  - Two golevelup behaviours the view now makes visible: a handler with no `connection` is registered on **every** declared connection (listed once per connection — the multi-vhost trap that asserts a queue on the wrong vhost), and a handler whose `name` matches no entry in that connection's `handlers` map is **not registered** at all, which the entry states in place of its description. Module-level `handlers` configs are merged into the displayed options exactly as golevelup merges them.

  Core: `DiscoverGroup` gains an optional `sections` — titled blocks of facts that are not entries (`name`, optional `kind` badge, `detail`, boolean `flags`, free-form `attributes`), exported as `DiscoverSection` / `DiscoverSectionItem`. The Discover panel renders them above the entry list and titles the list by what it holds (`Handlers`) when sections precede it; a group whose entries are empty but whose sections hold something now gets its view, so a broker an application only publishes to is still reported.

## 1.0.0-alpha.16

### Patch Changes

- 74d8986: Replace the single **Routes** panel with one **Discover** view per transport.

  "Routes" named the panel after one transport's vocabulary while listing four, and answered a question nobody asks that way: you look up the HTTP table, or the CLI's commands, not "all routes". Each registered `ProfilerRouteSource` now contributes its own sidebar view under a **Discover** heading — `Discover / HTTP`, `Discover / GraphQL`, `Discover / Commands`, `Discover / RabbitMQ` — each rendering that transport's table flat, with no group disclosure to open first, and counting its entries with the source's own noun (`4 commands`, `9 fields`). A transport that discovered nothing gets no view, so the sidebar lists only what the application actually registered.

  The `routes.png` screenshot is renamed `discover.png` and reshot on the HTTP view. The views are ordered deterministically — the built-in HTTP source first, then the other transports by label — instead of following the DI bootstrap order, which shuffled the sidebar between runs. They are keyed `discover-<transport>` in `?view=`, so they can never collide with the same-protocol profile list: `?view=graphql` stays the GraphQL list, `?view=discover-graphql` is its routing table. `discoverViewKey()`, `DISCOVER_GROUP` and `DISCOVER_GROUP_LABEL` are exported for consumers building their own links. The GraphQL, RabbitMQ and Commands sources declare the `itemLabel` their entries deserve; nothing else changes in how a source is registered.

- 74d8986: Make the home page's sidebar identical to a profile's, and give each subject exactly one glyph.

  The two navigations had drifted into two components: the home page indented its items further (`pl-6` against the detail page's `pl-3`), used a thinner separator and its own header padding, rendered a flat count badge where the detail page accents the active one, and carried no icon at all on the **Profiling** items. Both now share one nav-item partial — same padding, same badge scale, same active accent — and both render the icon in a fixed-width slot, so an item that declares no icon still lines its label up with the others.

  `ProfilerListSection` gains an optional `icon`. A protocol now keeps **one** glyph everywhere it is named, across both pages: the HTTP globe is defined once in the core (exported as `HTTP_ICON`) and used by the HTTP list section, the HTTP routing table and the HTTP Client collector panel; the GraphQL mark serves both the GraphQL list section and the GraphQL detail tab. That retires two near-duplicate marks — a second terminal glyph for Commands and a second GraphQL glyph — which existed only because each file defined its own copy. Tabs naming a _content_ rather than a protocol (Request, Response, Message, Performance…) keep their own icon.

  The HTTP routing table is labelled **HTTP** rather than **REST**, so the sidebar names the protocol once: `Profiling / HTTP` and `Discover / HTTP`, same word, same globe. `RouteGroup.label` for the built-in source changes accordingly; the `?view=discover-http` key is unchanged.

## 1.0.0-alpha.15

### Minor Changes

- bdbcba1: Profile the AMQP messages an application **publishes**, not just the ones it consumes.

  - New `RabbitMqPublishCollectorModule.forRoot()` / `.forRootAsync()` adds an **AMQP** panel listing every `AmqpConnection.publish` made while a profile was active: exchange, routing key, AMQP properties (`messageId`, `appId`, `correlationId`, `replyTo`), masked headers, captured payload, duration and outcome — plus a copy button holding a runnable `channel.publish(...)` snippet. Options: `enabled`, `captureHeaders`, `captureBody`, `maskHeaders`, `payloadLimits`, `slowThreshold`, `nPlusOneThreshold`, `chattyThreshold`, the matching severities and `error`.
  - Entries are tagged by the core rule engine in a new `amqp` domain, so a publish repeated once per loop iteration surfaces as N+1, a slow broker write as `slow`, and a rejected publish as `error`. A message the channel buffered (`publish()` resolving to `false`) is reported as `buffered` rather than an error. New public `AmqpPublishEntry` type.
  - The module is independent of `RabbitMqCollectorModule`: a publish-only API registers just this one, a consumer just the other, and an application doing both gets the publishes of its consumers listed on their message profiles. It works under any entrypoint (HTTP request, CLI command, consumed message) since the panel is profile-scoped. `nestjs-cls` joins the package's peer dependencies, as in every other collector package.
  - Core: the built-in performance rules no longer hardcode `query`/`request` wording — the N+1 detail and the default `chattyThreshold` are resolved per rule domain, so a non-query collector reads correctly ("Same message executed 3 times").

## 1.0.0-alpha.14

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.13

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

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

### Patch Changes

- a3ba8ee: Make the profiler-UI tables horizontally scrollable on narrow/mobile viewports (fixes #184).

  Every list-section table (HTTP, GraphQL, Command, RabbitMQ) and several collector-panel tables (schema, timeline, routes, cache, validator) were wrapped in an `overflow-hidden` container (there to clip the rounded corners), which also clipped horizontal overflow with no scrollbar — so on a phone the wide tables were squished and the right-hand columns became unreachable. Each wide table now sits in an `overflow-x-auto` container with a sensible `min-w`, so a table too wide to fit scrolls horizontally within its own card (rounded corners preserved) while the page body itself never scrolls sideways.

## 1.0.0-alpha.8

### Minor Changes

- 9b1d8a1: Public API and packaging cleanup before the stable release (breaking).

  - **GraphQL module renamed** for ecosystem consistency: `ProfilerGraphQLModule` → `GraphQLCollectorModule` and `ProfilerGraphQLModuleOptions` → `GraphQLCollectorModuleOptions` (all 11 other collectors already use `XxxCollectorModule`). No alias — update imports.
  - **`PROFILER_CONTEXT_ADAPTERS` removed** from the public API. It was never consumed by the core; the single supported way to register a context adapter is `ProfilerCoreService.registerContextAdapter(adapter)` from your module's `onModuleInit` (resolve the core with `moduleRef.get(ProfilerCoreService, { strict: false })`). The dead multi-token providers in the GraphQL and RabbitMQ modules are gone.
  - **Named ORM connections supported.** `TypeOrm`/`Mongoose`/`MikroOrm` collector options gain a `connectionName?: string`; the (optionally named) connection is injected by its resolved token, optionally, so a named-only setup no longer crashes at bootstrap and a missing connection warns instead. A `getRequest()` on context adapters lets the interceptor repose the transport request in CLS (fixes GraphQL requests showing as anonymous in the Security panel).
  - **Peer dependencies tightened.** The core peer on every collector is bounded (`>=1.0.0-alpha.7 <2.0.0`) instead of an unbounded `>=`. Optional peers (`axios`, `@golevelup/nestjs-rabbitmq`, `amqplib`, `@nestjs/graphql`, `class-validator`, `class-transformer`) are now declared in `peerDependencies` with ranges (plus `optional: true` in meta). `nest-profiler-http` no longer peer-depends on `@nestjs/axios` (it never imports it — you provide `axiosRef` via `forRootAsync`); `nest-profiler-commander` now declares `nest-commander` as a **required** peer (imported statically) rather than optional. ORM peer ranges widened to cover the installed base: `typeorm ">=0.3.20 <2.0.0"`, `mongoose "^8 || ^9"`. `nest-profiler-mikro-orm` requires Node `>=22.12.0` (stable `require(esm)`).
  - **Misc.** A throwing custom validator extractor can no longer turn a 400 into a 500; the RabbitMQ adapter's options are `@Optional()`; the dead `COMMANDER_COLLECTOR_OPTIONS` token is removed; the RabbitMQ package builds via the shared `repo-build`. `@golevelup/nestjs-rabbitmq` is now a dev dependency.

- 882e5ac: Add `forRootAsync` to every collector whose options are resolved at runtime, so masking, thresholds and capture flags can be driven from `ConfigService` (or any provider) instead of static literals.

  - New `forRootAsync({ imports?, inject?, useFactory })` on `TypeOrmCollectorModule`, `MongooseCollectorModule`, `MikroOrmCollectorModule`, `ConfigCollectorModule`, `AuthCollectorModule`, `RabbitMqCollectorModule` and `ValidatorCollectorModule`, mirroring the existing `HttpCollectorModule.forRootAsync`. Each package also exports a matching `*CollectorModuleAsyncOptions` type.
  - Collectors now share a `ConfigurableModuleBuilder`-based options token and a single `buildCollectorModule` helper (exported from `@eleven-labs/nest-profiler`) that centralizes the synchronous `enabled: false` short-circuit — so disabling behaves consistently across every collector.
  - `enabled` stays a synchronous build-time flag (it decides which providers are registered, which an async factory cannot); per-environment gating remains the host's job via `ConditionalModule.registerWhen(...)`. `HttpCollectorModule` is refactored onto the shared builder with no change to its public API (`HTTP_COLLECTOR_OPTIONS`, `HTTP_INSTRUMENTATIONS`, `axios`/`instrumentations` and the `axiosRef` contract are preserved).
  - `cache`, `commander` and `graphql` are intentionally left `forRoot`-only: their sole option is `enabled`, which has nothing to resolve asynchronously.

- a8a149b: Contribute **RabbitMQ** and **Commands** groups to the Routes panel (`@eleven-labs/nest-profiler-routes`).

  - `@eleven-labs/nest-profiler-rabbitmq`: `RabbitMqRouteSource` scans `@RabbitSubscribe` handlers (via the `RABBIT_HANDLER` metadata) and lists each consumer with its exchange, routing key and handler.
  - `@eleven-labs/nest-profiler-commander`: `CommanderRouteSource` scans nest-commander `@Command()` classes and lists each command with its name, declaring class and `--option` flags.

  Both self-register a `ProfilerRouteSource` with the core at bootstrap, so they appear in the panel automatically when the Routes panel package is installed.

- 9b1d8a1: Harden data capture and access control.

  - **Secret redaction everywhere.** A shared redaction utility (`redact`, exported from the core) now masks sensitive object keys (`password`, `token`, `apiKey`, DSN…) and credentials embedded in string values (URL userinfo `user:pass@`, JWTs, `sk-`/`pk-` keys, PEM blocks). It is applied to request headers (`maskHeaders`, default sensitive list — including the raw `cookie` header), config values (DSNs whose key is not itself sensitive, e.g. `DATABASE_URL`), the `@nestjs/config` `_PROCESS_ENV_VALIDATED` firehose is now dropped, SQL parameters (TypeORM/MikroORM), Mongo filters/pipelines, validator rejected values, RabbitMQ payloads, CLI arguments/options, session data, JWT claims and the auth user (now redacted recursively). The redaction sentinel is unified to `[REDACTED]`.
  - **`captureRequestBody` now defaults to `false`** (symmetry with `captureResponseBody`); captured bodies are redacted.
  - **No path traversal / token collisions.** The storage token is always an internal UUID; the client `x-request-id` header is kept only as a display-only `requestId` attribute. The file storage adapter additionally rejects any non-`[A-Za-z0-9_-]` token.
  - **Browser-usable access control.** `ProfilerGuard` now accepts the token via a `?token=` query parameter (not only `Authorization: Bearer`), exempts static assets under `__assets/*`, and compares tokens in constant time. Configuring a token no longer breaks the UI or the injected toolbar.
  - **Security headers** (`Cache-Control: no-store`, strict CSP, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`) on the HTML pages and the JSON export; the `X-Debug-Token` headers can be disabled with `emitDebugHeaders: false`.

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
