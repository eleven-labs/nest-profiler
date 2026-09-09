# @eleven-labs/nest-profiler-http

## 1.0.0-alpha.20

No changes in this release.

## 1.0.0-alpha.19

### Minor Changes

- e3b057e: Security fix and public-API hardening ahead of the stable release (breaking).

  - **Security: the profiler UI could be reached without credentials.** `ProfilerGuard` exempted static assets by testing the raw URL for `/__assets/`, and the raw URL carries the query string — so appending `?x=/__assets/` to any profiler route passed the guard with no credential at all, including `/_profiler` and the `/_profiler/:token/data` JSON export (request headers, cookies, session and captured bodies). The exemption is now matched on the request **path**, and only against the profiler's own asset prefix. Applications running the profiler behind a `security` strategy should upgrade.
  - **BREAKING: internal plumbing removed from the core entry point.** Everything the entry point exports is public API under semver, so helpers the profiler only uses on itself were freezing internals for the life of `1.x`. None of them is documented or used outside the core; if you import one, it has no replacement by design — open an issue describing the use case. Removed: `applyQueryInMemory`, `matchesQuery`, `resolveField`, `sortSections`, `DEFAULT_SECTION_ORDER`, `paginateProfiles`, `buildPageHref`, `PaginatedProfiles`, `ProfilerListPagination`, `elapsedMs`, `profileElapsedMs`, `registerGcCounter`, `GcCounter`, `analyzeStack`, `resolveStackAnalysisOptions`, `resolveSourceContextOptions`, `resolveExceptionCaptureOptions`, `resolveRedactionConfig`, `ResolvedRedactionConfig`, `buildTrace`, `resolveTraceId`, `TRACE_ROOT_ID`, `isTraceContributor`, `isTaggableCollector`, `DEFAULT_MAX_BODY_SIZE`, `DEFAULT_SECRET_KEY_RE`, `resolveEditorTemplate`, `EDITOR_NAMES`. Every extension contract, DI token and type they support stays exported.
  - **The SQLite store now carries a schema version.** `CREATE TABLE IF NOT EXISTS` never alters an existing database, so a release adding an indexed column would have left an old `.db` file one column short and every query against it failing. The store stamps `PRAGMA user_version` and recreates itself when it does not match, which is what lets the schema evolve in a minor release.
  - **DI tokens moved to the global symbol registry.** `PROFILER_STORAGE_ADAPTER`, `PROFILER_ENABLED` and `HTTP_INSTRUMENTATIONS` were bare `Symbol()`s, which are unique per module instance: two copies of a package in one dependency tree would provide under one token and inject under another, and Nest would report the provider as simply missing. They now use `Symbol.for`, like `PROFILER_REQ_KEY` always has. Import the constant as before — the change is invisible to callers.
  - **`formatPhaseDuration` is exported** from `@eleven-labs/nest-profiler-http`. It was documented in the API reference but missing from the barrel.

### Patch Changes

- e3b057e: Fixes to the HTTP phase timer and the event-emitter collector found in review.

  - **Socket listener leak on keep-alive connections.** `instrumentClientRequest` attached `lookup`/`connect`/`secureConnect` listeners to the socket and relied on them removing themselves when they fired. On a pooled socket those events never fire again, so nothing consumed them: `MaxListenersExceededWarning` landed on the 11th request through one connection, and every retained closure kept that request's marks alive for the life of the socket. Node >= 19 keeps `http.globalAgent` alive by default, so this was the ordinary path. The listeners are now detached when the request can no longer produce a connection phase.
  - **BREAKING: a handler carrying several `@OnEvent` decorators is named after all of them.** The method is wrapped once, so the wrapper cannot know which subscription fired — `@nestjs/event-emitter` registers it as `(...args) => instance[method](...args)`. It previously reported the alphabetically first event, mislabelling every profile produced by the others (including the `attributes.event` facet the Events filter queries). Such profiles are now filed under `"a, b"`. Split the method in two to keep them apart.
  - **A synchronous `@OnEvent` handler stays synchronous.** The wrapper always returned a promise, so a sync handler that threw produced a rejected promise instead: `emit()` discards a listener's return value, so the emitter's `try`/`catch` never saw the failure (it went missing from the emitting profile's Events panel, contradicting what `suppressErrors: false` promises) and Node terminated the process on the unhandled rejection. The awaited path is unchanged.
  - **Event profiles now carry a trace and a version.** The collector ran `collectAll` and `storage.save` by hand instead of `ProfilerCoreService.persist`, skipping the version stamp and the trace assembly — so an event profile reached storage with an empty waterfall.
  - **The emitter's configured `delimiter` is honoured.** An array-form `@OnEvent(['order', 'created'])` was always joined with a dot, naming the subscription `order.created` under an emitter that dispatches `order/created`.
  - The Payload section of the event detail page emitted its `class` attribute HTML-escaped, so its spacing never applied; and an entry carrying only an error offered an expand chevron that unfolded to "No payload captured for this event" — the error is already shown on the row.
  - `UndiciPhases.install()` counted a phase-slot provider before its own idempotency guard, so a second application lifecycle in one process inflated the counter while the subscriptions stayed at one.

## 1.0.0-alpha.18

### Minor Changes

- 0bd3dc9: Break each outgoing HTTP call into its phases — DNS, handshake, time-to-first-byte, download — behind two opt-in providers, and make the breakdown something any client can feed.

  `HttpRequestEntry` gains an optional `phases` field (`HttpPhases`: `wait`, `dns`, `tcp`, `tls`, `connect`, `request`, `firstByte`, `download`, all optional durations in ms). The names are the de-facto vocabulary — `got`/`@szmarczak/http-timer` use them and they map onto the browser's `PerformanceResourceTiming` — so nothing new has to be learned to read a profile.

  - **`NodeHttpPhases`** (`/phases`) wraps `request`/`get` on `node:http` and `node:https`, covering every client built on them: axios, superagent, `got`, `node-fetch`, a hand-rolled `https.request`. It is the timings-only counterpart of the `node:http` _recording_ adapter this package deliberately does not ship — the objection to that adapter was that capturing a response body means reading the stream and stealing chunks from a caller consuming it in paused mode, and a timer reads nothing.
  - **`UndiciPhases`** (`/phases`) subscribes to undici's `diagnostics_channel` events, the only way to time `fetch`, which runs on undici and never goes through `node:http`. Correlation with the recorded call is exact, not heuristic: the subscribers run in the async context of the `fetch()` that triggered them, so they find that call's phase slot.
  - Both providers **record nothing** — no entry, no header, no body — so neither can double-record with an adapter, and both are selected like any adapter, in `instrumentations`. Nothing is patched or subscribed unless listed.
  - `readHttpPhases(source)` finds the breakdown behind whatever a custom instrumentation holds: an `AxiosResponse`, an axios error, a `ClientRequest`, an `IncomingMessage`, a `follow-redirects` wrapper (the final hop wins — its phases describe the response the caller got), or a `got` response, whose native `timings` are read without depending on `@szmarczak/http-timer`.
  - `instrumentClientRequest(request)` times one request with no global patch, for a client that hands its request over (`got.stream(url).on('request', …)`). `openPhaseSlot` / `activePhaseSlot` / `phaseSlotsEnabled` expose the async-context channel for a client that exposes no transport at all. A client that measured nothing but its own time-to-first-byte can still pass `phases: { firstByte: 42 }`.
  - The panel gains a **Phases** column with a stacked bar (hover a segment, or expand the row for the numbers), and the Timeline waterfall carries the same breakdown as labelled extras on the call's bar.
  - A partial breakdown is the normal case and stays visible as such: a reused keep-alive connection reports no handshake, an IP literal no DNS, undici one coarse `connect` instead of dns/tcp/tls, and a `fetch` whose body is still streaming no `download` — whatever the phases do not account for is drawn as an explicit **Other** segment rather than folded into a neighbour.
  - The fetch adapter enters no async context while no provider is installed, so the default hot path is unchanged.

- a512259: Raise the `@nestjs/core` peer to `^11.1.4`, forward the trace id on outgoing calls, and make the trace lens reach the table under the waterfall.

  - **`@nestjs/core` peer is now `^11.1.4`**, the first release carrying the `instrument` option on `NestFactory`. A peer range only warns at install, so `createProfilerInstrument()` also checks the resolved version and says so once — on an older Nest the option is ignored and the feature is _silently_ inert, which is the worst failure mode for a debugging tool.
  - **`propagateTraceId`** on `HttpCollectorModule` forwards the profile's trace id on every instrumented outgoing call (`true` for `x-request-id`, or a header name). Off by default: adding a header to an application's outgoing traffic is a visible change. A header the caller set explicitly always wins, and nothing is added outside a profiled request.
  - **The Execution Trace lens now filters the table below the bars**, not only the bars. "I/O only" used to hide the method bars and still list every one of them underneath. Rows carry the same span id, so folds reach them too, and a count appears when you are looking at a subset.

- 6593feb: Mask credentials carried in the query string of an outgoing request.

  The URL of every captured outgoing call was recorded verbatim, so an upstream API key, an access token or a signed-URL signature passed as a query parameter was readable in the HTTP Client panel, in the `/_profiler/:token/data` export and on disk for the whole `ttl` — while the _headers_ of the same call were already masked.

  - Query-parameter values are now masked in the recorded URL, from the core's built-in list (`token`, `access_token`, `refresh_token`, `api_key`, `code`, `state`, `signature`, `password`, `secret`, `client_secret`…), matched case-insensitively and ignoring `-`/`_`. Parameter names are kept and only values replaced, so a recorded URL still reads `?api_key=[REDACTED]`.
  - **New options:** `maskQueryParams` (extra parameter names, merged with the built-ins) and `useDefaultMaskQueryParams` (`true` by default) to opt out of the built-in list deliberately — the same additive shape as `maskHeaders`.
  - **New exports:** `DEFAULT_MASK_QUERY_PARAMS`, `redactQueryString`, `resolveMaskedQueryParams`.

  Masking is applied by `HttpProfilerRecorder.capture()`, which both bundled instrumentations (axios, fetch) and the recommended custom-client path go through. `record()` and `appendHttpRequestEntry()` keep bypassing every capture flag and all masking by design — they append the entry you built as-is — so redact the URL yourself with the exported `redactQueryString` when you use them.

  The N+1 fingerprint is unaffected: it is built from method, host and path, and never included the query string.

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

- 5ea9463: Fill the trace waterfall with the work the collectors already capture.

  - `appendCollectorEntry()` — the single funnel every instrumentation in every package goes through — now stamps each entry with the trace span that was open when it was captured. The parent is therefore exact rather than inferred from overlapping time windows, which is what makes it right under concurrency: two calls fired together no longer nest under one another.
  - New `TraceContributor` implementations project already-collected entries onto the trace: every query collector (TypeORM, MikroORM, Mongoose) through `AbstractQueryCollector`, plus the HTTP-client and cache collectors. Nothing is re-timed — the shared `entriesToSpans()` helper reads the `startedAt`, `duration`, tags and parent each entry already carries.
  - Each bar links back to the row holding its detail, and a grouped collector links to its group panel (`database`) rather than to itself.
  - The HTTP collector classifies a failed bar with its own `error` option, so a 404 reddens only where the application says it should.
  - New exports: `entriesToSpans`, `EntrySpanOptions`. Entry interfaces gain `parentSpanId`.

### Patch Changes

- 211a2b7: Documentation-only pass aligning every guide, README and agent skill with the current API.

  Corrected what no longer matches the code: the `slowQueryThreshold` option (renamed `slowThreshold`) in the root README and the example app, the `HttpCollectorModule.forRootAsync({ axiosRef })` snippet in Getting started (adapters are now selected through `instrumentations`, and the axios one auto-discovers every `HttpService`), the non-existent `ProfilerViewsSetup` export, the removed **Timeline** tab (the breakdown is drawn in the Performance tab's **Execution Trace**), and the claim that the inert layer binds a separate no-op service — `TracerService` is registered with none of its optional dependencies, which is what makes it a no-op. Dropped the migration and deprecated-option notes: nothing has shipped stable, so there is no older way worth documenting.

  Filled the gaps left by recent features: `createProfilerInstrument` / `ProfilerInstrumentOptions` and the trace helpers now appear in the core API reference, the `event` kind is listed in the error-classification table, the event-emitter and RabbitMQ-publish domains in the performance-tag thresholds, the `zero-rows` tag in the tag filter and the skill, and the `routes`, `rabbitmq` and `event-emitter` packages in the package tables, tutorial index and Profiler UI tour.

- ec8aad8: Consolidate three sets of internals that had been copied across the workspace, and record exception causes.

  **Reading the active profile.** `readProfile`, `readToken`, `readRequest` and `setProfileContext` are the way to reach the profiling context. The CLS store was previously addressed by string literal in 24 places across ten packages, each with its own `try`/`catch` — and `PROFILER_CLS_KEYS`, which existed precisely to prevent that, was used almost nowhere. A mistyped key reads as `undefined` rather than failing, silently turning a collector into a no-op; the accessors remove the opportunity. `PROFILER_CLS_KEYS` also gains the `token` key it was missing while three packages wrote the literal.

  **Exception causes and codes.** `toExceptionEntry` replaces the four hand-rolled constructions of an `ExceptionEntry` (the interceptor's HTTP and non-HTTP paths, the catch-all exception filter, the command profiler), which had all drifted into recording only `name`, `message` and `stack`. Two things are now captured:

  - **`ExceptionEntry.cause`** — the `cause` chain of a wrapped error, recorded recursively to a bounded depth and cycle-safe. An `InternalServerErrorException` says nothing; the `QueryFailedError` underneath says everything. The Exceptions tab renders the chain as one `Caused by` block per level.
  - **`ExceptionEntry.code`** — a machine-readable code carried by the error (`ENOENT`, `ECONNREFUSED`, a driver's own), which the `exception` list filter groups by in preference to the class name.

  Coercion of a non-`Error` throw is deliberately unchanged, so existing profiles keep grouping under `Error`.

  **Shared collector options.** `CollectorModuleOptions` (the `enabled` flag, previously redeclared in twelve interfaces) and `TagSeverityOptions` (the tag severities, redeclared in five) are declared once in the core and extended by each collector's options interface. Only options whose meaning _and_ default are identical everywhere moved: the numeric thresholds stay per package, because a slow SQL query is 100 ms, a slow outgoing HTTP call 300 ms and a slow publish 50 ms — that default is the useful half of the documentation.

  No behaviour change and no configuration change: every option keeps its name, type and default, and the accessors return exactly what the code they replace returned.

## 1.0.0-alpha.17

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.16

### Patch Changes

- 74d8986: Make the home page's sidebar identical to a profile's, and give each subject exactly one glyph.

  The two navigations had drifted into two components: the home page indented its items further (`pl-6` against the detail page's `pl-3`), used a thinner separator and its own header padding, rendered a flat count badge where the detail page accents the active one, and carried no icon at all on the **Profiling** items. Both now share one nav-item partial — same padding, same badge scale, same active accent — and both render the icon in a fixed-width slot, so an item that declares no icon still lines its label up with the others.

  `ProfilerListSection` gains an optional `icon`. A protocol now keeps **one** glyph everywhere it is named, across both pages: the HTTP globe is defined once in the core (exported as `HTTP_ICON`) and used by the HTTP list section, the HTTP routing table and the HTTP Client collector panel; the GraphQL mark serves both the GraphQL list section and the GraphQL detail tab. That retires two near-duplicate marks — a second terminal glyph for Commands and a second GraphQL glyph — which existed only because each file defined its own copy. Tabs naming a _content_ rather than a protocol (Request, Response, Message, Performance…) keep their own icon.

  The HTTP routing table is labelled **HTTP** rather than **REST**, so the sidebar names the protocol once: `Profiling / HTTP` and `Discover / HTTP`, same word, same globe. `RouteGroup.label` for the built-in source changes accordingly; the `?view=discover-http` key is unchanged.

## 1.0.0-alpha.15

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

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

## 1.0.0-alpha.8

### Major Changes

- 000cb7d: Make the HTTP collector genuinely client-agnostic: pluggable axios/fetch instrumentations with subpath exports and auto-discovery, plus a documented path to bring your own client.

  BREAKING: adapters are now selected explicitly by importing their class from a subpath; the `axios` flag and the `axiosRef` option are removed.

  - Ship two opt-in, subpath-isolated instrumentations, each selected via `instrumentations: [...]`: `AxiosInstrumentation` (`/axios`) and `FetchInstrumentation` (`/fetch`). Both capture request and response bodies safely. Nothing is instrumented unless listed; the root barrel exports only the client-agnostic API and never loads a client library.
  - `AxiosInstrumentation` now **auto-discovers** every axios instance in the DI container via `DiscoveryService` — every `@nestjs/axios` `HttpService` (including per-feature `HttpModule.register()` instances) and bare axios instances — so multiple clients are captured with no per-instance wiring. It still never imports `@nestjs/axios`.
  - `FetchInstrumentation` patches `globalThis.fetch` (Node ≥ 22 built-in, undici-backed) and needs no dependency.
  - Any other client (got, undici, superagent, a bespoke NestJS service…) is covered by implementing the `HttpInstrumentation` interface with the client's own hooks, or by recording inline via `HttpProfilerRecorder.capture(...)` — both documented, and both yield full request/response fidelity.
  - BREAKING: the `axios` boolean flag is removed — select axios via `instrumentations: [AxiosInstrumentation]`. The `axiosRef` option is removed — the axios adapter auto-discovers instances instead. `AxiosInstrumentation` moves from the root barrel to the `@eleven-labs/nest-profiler-http/axios` subpath.

  Migrate by dropping the `forRootAsync({ axiosRef })` wiring and selecting adapters instead: `HttpCollectorModule.forRoot({ instrumentations: [AxiosInstrumentation] })`, importing `AxiosInstrumentation` from `@eleven-labs/nest-profiler-http/axios`.

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

- ffa4d9a: Detect performance anti-patterns (N+1, slow, error, chatty, large-payload) across SQL, Mongo and outgoing HTTP with a rule-based tagging engine.

  The core now runs a single analysis pass (`analyzeProfile`) once per profile — after every collector, before persistence — that groups entries on a collector-supplied `fingerprint` and applies `PerformanceRule`s, attaching structured `ProfilerTag[]` (`{ id, label, severity, count?, detail? }`) to each entry and aggregating them onto `profile.tags`. Built-in rules: `slow`, `n-plus-one` (the N+1 anti-pattern), `error`, `chatty` and `large-payload` (HTTP). Contribute your own via `ProfilerModule.forRoot({ performance: { rules: [...] } })` or `ProfilerCoreService.registerPerformanceRule()`; the emitted tag ids become filterable.

  Tags surface as coloured pills on each query/HTTP row and in the panel headers; the detail page shows a prominent **Performance** banner listing the issues and colour-codes the affected collector's nav tab by severity (the tab badge stays a plain count). On the list page, tags render as pills and a new **Performance tag** filter (Slow / N+1 / Chatty / Large payload, plus any custom id via `registerFilterOption('tag', …)`) plus a separate **With errors** checkbox replace the former **With exceptions** checkbox (errors are failures, not performance issues; the checkbox is broader — it covers failed HTTP/query calls too). The SQLite adapter gains an indexed `tags` column.

  **Breaking changes**

  - The per-query `isSlow` boolean is removed from `QueryEntry`, `MongooseQueryEntry` and the Mongo entry shape; "slow" is now the `slow` tag, computed centrally by the engine (no longer at capture time). Read it from `entry.tags` (or `profile.tags`).
  - Each collector's `slowQueryThreshold` option is renamed to `slowThreshold`, and gains sibling options `nPlusOneThreshold` (default 2) and `chattyThreshold` (default 20; `10` for HTTP). The HTTP collector additionally gains `slowThreshold` (default 300 ms) and `largePayloadThreshold` (default 1 MB).
  - The built-in `hasExceptions` list filter is removed in favour of the generic `tag` filter.

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

- 9b1d8a1: Harden data capture and access control.

  - **Secret redaction everywhere.** A shared redaction utility (`redact`, exported from the core) now masks sensitive object keys (`password`, `token`, `apiKey`, DSN…) and credentials embedded in string values (URL userinfo `user:pass@`, JWTs, `sk-`/`pk-` keys, PEM blocks). It is applied to request headers (`maskHeaders`, default sensitive list — including the raw `cookie` header), config values (DSNs whose key is not itself sensitive, e.g. `DATABASE_URL`), the `@nestjs/config` `_PROCESS_ENV_VALIDATED` firehose is now dropped, SQL parameters (TypeORM/MikroORM), Mongo filters/pipelines, validator rejected values, RabbitMQ payloads, CLI arguments/options, session data, JWT claims and the auth user (now redacted recursively). The redaction sentinel is unified to `[REDACTED]`.
  - **`captureRequestBody` now defaults to `false`** (symmetry with `captureResponseBody`); captured bodies are redacted.
  - **No path traversal / token collisions.** The storage token is always an internal UUID; the client `x-request-id` header is kept only as a display-only `requestId` attribute. The file storage adapter additionally rejects any non-`[A-Za-z0-9_-]` token.
  - **Browser-usable access control.** `ProfilerGuard` now accepts the token via a `?token=` query parameter (not only `Authorization: Bearer`), exempts static assets under `__assets/*`, and compares tokens in constant time. Configuring a token no longer breaks the UI or the injected toolbar.
  - **Security headers** (`Cache-Control: no-store`, strict CSP, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`) on the HTML pages and the JSON export; the `X-Debug-Token` headers can be disabled with `emitDebugHeaders: false`.

### Patch Changes

- 9b1d8a1: Fix two release blockers.

  - **http**: the package no longer references `@nestjs/axios` at all (no import, no lazy `require`). Installing `@eleven-labs/nest-profiler-http` never touches the peer, so a "bring your own client" (fetch/undici/got) setup can't crash at import. To instrument axios you now hand the collector your `HttpService.axiosRef` via `HttpCollectorModule.forRootAsync({ inject: [HttpService], useFactory: (http) => ({ axiosRef: http.axiosRef }) })`; the axios adapter no-ops when no `axiosRef` is provided.
  - **core**: the injected toolbar now loads a dedicated, preflight-free stylesheet (`toolbar.css`) scoped under `#profiler-toolbar`, instead of the full `profiler.css`. Tailwind's universal preflight reset is no longer applied to profiled host pages, so enabling the toolbar no longer breaks the host application's layout.

## 1.0.0-alpha.7

### Patch Changes

- e5464e6: Ship the profiler UI's browser behaviour as compiled, same-origin JavaScript bundles instead of inline template scripts, and make the client layer extensible.

  - All authored client behaviour (theme toggle, syntax highlighting, copy-to-clipboard, filter forms, tab switching) now lives in TypeScript, is bundled at build time, and is served under `/_profiler/__assets/scripts/*`. The HTML templates carry no inline `<script>` blocks and no `on*` attributes, so a strict `script-src 'self'` Content-Security-Policy works out of the box.
  - New `window.NestProfiler` browser runtime (`onReady`, `delegate`, `copyText`, `highlight`) that other bundles reuse — the only cross-bundle contract.
  - New `ClientAssetRegistry` service (exported, with `CORE_CLIENT_SCRIPT` and the `ClientAssetRegistration` type): a package shipping its own collector can register a client bundle so the profiler serves it and injects its `<script>` after `profiler.js`.
  - `nest-profiler-http`: the HTTP Client panel's request-row expand/collapse behaviour moves out of inline template handlers into a compiled `http.js` bundle registered automatically via `ClientAssetRegistry` — a reference implementation of the pattern. No consumer-facing change.

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

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.4

### Major Changes

- 2b0e626: Make HTTP-client profiling client-agnostic and rename the axios package.

  BREAKING: `@eleven-labs/nest-profiler-axios` is renamed to `@eleven-labs/nest-profiler-http`, which is now client-agnostic. The old package is kept as a deprecated re-export shim and will be removed in a future release.
  - `@eleven-labs/nest-profiler-http` now owns the full HTTP-client contract: the `HttpRequestEntry` type, the `HttpClientCollector` + panel, the injectable `HttpProfilerRecorder`, the low-level `appendHttpRequestEntry(cls, entry)` helper, the redaction helpers (`DEFAULT_MASK_HEADERS` / `extractHeaders` / `formatHeaderValue`), and a pluggable `HttpInstrumentation` interface. The core `@eleven-labs/nest-profiler` is unchanged and stays HTTP-agnostic.
  - axios is now one **instrumentation** (`AxiosInstrumentation`) among others, enabled by default and no-op when `@nestjs/axios` is absent. Any client (fetch, undici, got, custom) feeds the same panel by injecting `HttpProfilerRecorder` or by registering a custom `HttpInstrumentation`.
  - The module is renamed `AxiosCollectorModule` → `HttpCollectorModule`; `forRoot()` accepts `axios`, `instrumentations` and the shared `HttpCaptureOptions`. `AxiosCollectorModule` remains exported from the deprecated shim as an alias.
  - The collector panel id / storage key is now `http-client` (was `axios`): stored data moves from `profile.collectors['axios']` to `profile.collectors['http-client']`.

  Migrate by installing `@eleven-labs/nest-profiler-http` and replacing `AxiosCollectorModule` with `HttpCollectorModule` (same options). Keep `HttpModule` from `@nestjs/axios` in the same module to use the axios adapter.

> Renamed from `@eleven-labs/nest-profiler-axios`. Earlier entries below predate the rename.

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

- ff89de2: First public npm (alpha) release. `@eleven-labs/nest-profiler-axios` is the HTTP-client collector for `@eleven-labs/nest-profiler`:
  - Captures outgoing HTTP requests made through the `@nestjs/axios` `HttpService` (method, URL, status code, duration).
  - Displays them in the **HTTP Client** panel with per-request timing bars and a collapsible Request/Response headers + body detail (JSON syntax highlighting).
  - Capture options: `captureRequestHeaders` (default `true`), `captureRequestBody` (default `true` for non-GET/HEAD), `captureResponseHeaders` (default `true`), `captureResponseBody` (default `false`).
  - Automatic masking of sensitive headers (`authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `proxy-authorization`), extendable via `maskHeaders`.
  - Request-count badge with error highlighting (e.g. `3 (1 err)`); idempotent instrumentation (`__profilerPatched`) so requests are never recorded twice.
  - `enabled` option (no-op providers when `false`) and `AxiosCollectorModule.forRoot()`; optional peer dependencies on `@nestjs/axios` and `axios`.

- Updated dependencies [ff89de2]
  - @eleven-labs/nest-profiler@0.5.1-alpha.0
