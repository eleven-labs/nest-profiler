# @eleven-labs/nest-profiler

## 1.0.0-alpha.19

### Major Changes

- e3b057e: Security fix and public-API hardening ahead of the stable release (breaking).

  - **Security: the profiler UI could be reached without credentials.** `ProfilerGuard` exempted static assets by testing the raw URL for `/__assets/`, and the raw URL carries the query string — so appending `?x=/__assets/` to any profiler route passed the guard with no credential at all, including `/_profiler` and the `/_profiler/:token/data` JSON export (request headers, cookies, session and captured bodies). The exemption is now matched on the request **path**, and only against the profiler's own asset prefix. Applications running the profiler behind a `security` strategy should upgrade.
  - **BREAKING: internal plumbing removed from the core entry point.** Everything the entry point exports is public API under semver, so helpers the profiler only uses on itself were freezing internals for the life of `1.x`. None of them is documented or used outside the core; if you import one, it has no replacement by design — open an issue describing the use case. Removed: `applyQueryInMemory`, `matchesQuery`, `resolveField`, `sortSections`, `DEFAULT_SECTION_ORDER`, `paginateProfiles`, `buildPageHref`, `PaginatedProfiles`, `ProfilerListPagination`, `elapsedMs`, `profileElapsedMs`, `registerGcCounter`, `GcCounter`, `analyzeStack`, `resolveStackAnalysisOptions`, `resolveSourceContextOptions`, `resolveExceptionCaptureOptions`, `resolveRedactionConfig`, `ResolvedRedactionConfig`, `buildTrace`, `resolveTraceId`, `TRACE_ROOT_ID`, `isTraceContributor`, `isTaggableCollector`, `DEFAULT_MAX_BODY_SIZE`, `DEFAULT_SECRET_KEY_RE`, `resolveEditorTemplate`, `EDITOR_NAMES`. Every extension contract, DI token and type they support stays exported.
  - **The SQLite store now carries a schema version.** `CREATE TABLE IF NOT EXISTS` never alters an existing database, so a release adding an indexed column would have left an old `.db` file one column short and every query against it failing. The store stamps `PRAGMA user_version` and recreates itself when it does not match, which is what lets the schema evolve in a minor release.
  - **DI tokens moved to the global symbol registry.** `PROFILER_STORAGE_ADAPTER`, `PROFILER_ENABLED` and `HTTP_INSTRUMENTATIONS` were bare `Symbol()`s, which are unique per module instance: two copies of a package in one dependency tree would provide under one token and inject under another, and Nest would report the provider as simply missing. They now use `Symbol.for`, like `PROFILER_REQ_KEY` always has. Import the constant as before — the change is invisible to callers.
  - **`formatPhaseDuration` is exported** from `@eleven-labs/nest-profiler-http`. It was documented in the API reference but missing from the barrel.

## 1.0.0-alpha.18

### Major Changes

- 211a2b7: BREAKING: remove the deprecated surface so the first stable release ships one way to do each thing.

  `ProfilerModuleOptions` no longer carries the flat masking options `maskCookies`, `maskHeaders`, `useDefaultMaskHeaders`, `maskQueryParams` and `useDefaultMaskQueryParams`. The unified `redaction` block replaces all five: `redaction.cookies`, `redaction.headers`, `redaction.queryParams`, and `redaction.useDefaults: false` for the total opt-out that the two `useDefaultMask*` flags used to express per list. `resolveRedactionConfig()` now resolves that block alone, so there is a single merge to reason about instead of two surfaces that had to agree.

  `StorageFindOptions` is removed and `IProfilerStorageAdapter.findAll()` takes no argument. The dashboard has driven its lists through `ProfilerQuery` / `query()` for a while and nothing passed those HTTP-centric filters any more; the in-memory filter helper behind them goes with the type. A custom adapter that declared `findAll(options?)` keeps compiling — the parameter is simply never supplied — and one that filtered on it should implement `query()` instead.

  These options are per-collector, not core, and are untouched: `maskHeaders` on `nest-profiler-http` and `nest-profiler-rabbitmq`, `maskKeys` on `nest-profiler-config`, `maskUserFields` on `nest-profiler-auth`.

- 65cc02c: Read an exception the way a stack is actually read (breaking).

  The Exceptions tab used to dump `Error#stack` into a `<pre>` and, when `sourceContext` was on, repeat the same information as five code excerpts below it. Both halves are now one structured view: the throw site first, with its source; the remaining application frames behind one disclosure; and everything below the application — dependencies and Node internals — collapsed into a single count. The `cause` chain gets the same treatment at every level.

  **BREAKING — `sourceContext` now defaults to `true`.** Code excerpts were the most Symfony-like thing the profiler had and they were invisible unless you knew to ask. Nothing leaves the machine: the file is read off disk and stored on the profile like everything else. Pass `sourceContext: false` to keep the grouped frames without reading any source.

  **BREAKING — `ExceptionEntry.frames` holds the whole stack, not only the annotated part.** Frames are now parsed unconditionally (no I/O), each carrying `isApplication`, and `lines` is present only on the application frames that got an excerpt. Previously non-application frames were dropped, which is why the raw stack string had to stay on screen. `stack` is still recorded, and is what the tab falls back to when no frame parses out of it.

  - **New `editor` option** — turns every source location into a link that opens the file at the right line, Symfony's `framework.ide`. A known name (`vscode`, `vscode-insiders`, `cursor`, `windsurf`, `zed`, `webstorm`, `idea`, `phpstorm`, `sublime`, `textmate`) or a URL template with `%f` and `%l`. Only frames that resolved under `projectRoot` are linked; an unknown name warns at startup and renders plain text.
  - **New `projectRoot` option** (default `process.cwd()`) — what tells an application frame from a dependency, the only directory `sourceContext` may read inside, and the root display paths are relative to. Set it when the process does not start from the application root.
  - **Frames read better.** Paths are relative (`src/catalog/product.service.ts:49:21` rather than an absolute path with no position), a dependency path is shortened to its own package root (a pnpm store path included), `async` becomes a badge instead of part of the function name, V8's `new` prefix and `[as alias]` suffix are stripped, and the faulty line carries a caret under its column. Excerpts are syntax-highlighted.
  - **A rejected DTO finally says what was wrong.** `ExceptionEntry.details` records the response payload an `HttpException` answered with, which is the only place a validation failure's field errors exist — `HttpException#message` for a `BadRequestException(violations)` is the generic `"Bad Request Exception"`. The tab shows the payload's message lines instead of the exception's own whenever they differ, and renders anything else the payload held under **Response payload**. Bounded and masked like a captured body, but not gated by `collectBody`: it is the error the caller already received. Nothing is stored when the payload merely restates the exception.
  - **A framework-only stack is no longer given a fake throw site.** A validation error throws inside `@nestjs/common`, so promoting one of its frames to `Thrown at` emphasised the one line the reader cannot act on. Such a stack now names its throw site on a single line and keeps every frame collapsed.
  - **A handled error no longer looks like a 500.** `ExceptionEntry.handled` was recorded and never displayed: an error reported through `TracerService.captureError()` now wears a `Handled` badge and the softer colour, and says `caught in` rather than `thrown in`.
  - **The failing handler is named** — `thrown in ProductController.create`, above the frame that says where it was thrown.
  - Frames are capped at 50 per exception, so a runaway recursion cannot flood storage.
  - An application frame is now one **resolving under `projectRoot`**, rather than one that merely does not look like a dependency — a stricter definition that drops the `internal/` substring heuristic, which flagged an application path such as `src/internal/foo.ts` as a Node internal.
  - **API changes:** `buildSourceContext` is replaced by `analyzeStack`, `ToExceptionEntryOptions` by `ExceptionCaptureOptions`, and `ProfilerCoreService.sourceContext` by `ProfilerCoreService.exceptionCapture` (carrying every setting, so a package building its own profile shares them all). `resolveSourceContextOptions(undefined)` now returns the defaults rather than `undefined`. New exports: `analyzeStack`, `resolveStackAnalysisOptions`, `resolveExceptionCaptureOptions`, `createEditorLink`, `resolveEditorTemplate`, `EDITOR_NAMES`, and the `ExceptionCaptureOptions`/`StackAnalysisOptions`/`ProfilerEditorName`/`EditorLink` types.

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

- a512259: Add optional automatic instrumentation: one span per provider method call, so the Performance tab shows the full call tree — which controller called which service, which called which repository, and what each cost.

  `createProfilerInstrument()` builds the `instanceDecorator` that `NestFactory` accepts through its `instrument` option (requires `@nestjs/core` 11.1.4+). It is **off by default and belongs in development**: it proxies every provider instance, so every property access goes through a trap whether or not the request is profiled.

  - Spans carry `kind: 'method'` and go into the same `Profile.trace` as everything else, so a query is nested under the repository method that issued it.
  - The Performance tab gains a lens over that one tree — **All / I/O only / Code only** — rather than a second panel, so hiding method rows leaves their children attached to their real parent.
  - The profiler's own providers and `ClsService` are excluded automatically. Without that, one request produced 75 spans of which about a dozen were application code; `includeInternals: true` opts back in, for debugging the profiler itself.
  - `skip(instance)` excludes a provider, `maxDepth` (default 20) bounds the tree's depth. Recursion is handled separately by a re-entrancy guard.
  - Instances a Proxy would break are handed back untouched: bare built-ins (`useValue: new Map()`), callable objects (a Mongoose model, an Axios instance), classes, and anything whose prototype cannot be read. Classes with native private members and built-in subclasses run against the raw receiver so their brand checks and internal slots keep working.
  - New exports: `createProfilerInstrument`, `ProfilerInstrumentOptions`, `markInternal`, `isInternal`.

- ec8aad8: Consolidate three sets of internals that had been copied across the workspace, and record exception causes.

  **Reading the active profile.** `readProfile`, `readToken`, `readRequest` and `setProfileContext` are the way to reach the profiling context. The CLS store was previously addressed by string literal in 24 places across ten packages, each with its own `try`/`catch` — and `PROFILER_CLS_KEYS`, which existed precisely to prevent that, was used almost nowhere. A mistyped key reads as `undefined` rather than failing, silently turning a collector into a no-op; the accessors remove the opportunity. `PROFILER_CLS_KEYS` also gains the `token` key it was missing while three packages wrote the literal.

  **Exception causes and codes.** `toExceptionEntry` replaces the four hand-rolled constructions of an `ExceptionEntry` (the interceptor's HTTP and non-HTTP paths, the catch-all exception filter, the command profiler), which had all drifted into recording only `name`, `message` and `stack`. Two things are now captured:

  - **`ExceptionEntry.cause`** — the `cause` chain of a wrapped error, recorded recursively to a bounded depth and cycle-safe. An `InternalServerErrorException` says nothing; the `QueryFailedError` underneath says everything. The Exceptions tab renders the chain as one `Caused by` block per level.
  - **`ExceptionEntry.code`** — a machine-readable code carried by the error (`ENOENT`, `ECONNREFUSED`, a driver's own), which the `exception` list filter groups by in preference to the class name.

  Coercion of a non-`Error` throw is deliberately unchanged, so existing profiles keep grouping under `Error`.

  **Shared collector options.** `CollectorModuleOptions` (the `enabled` flag, previously redeclared in twelve interfaces) and `TagSeverityOptions` (the tag severities, redeclared in five) are declared once in the core and extended by each collector's options interface. Only options whose meaning _and_ default are identical everywhere moved: the numeric thresholds stay per package, because a slow SQL query is 100 ms, a slow outgoing HTTP call 300 ms and a slow publish 50 ms — that default is the useful half of the documentation.

  No behaviour change and no configuration change: every option keeps its name, type and default, and the accessors return exactly what the code they replace returned.

- 017e485: Measure CPU, memory, event-loop and garbage collection — per request, and for the process.

  Until now a profile carried one resource number: `heapUsed`, the process heap at the moment the request started, documented as not being per-request. So the profiler could say a request took 300 ms but not whether it spent them computing or waiting — which is the first thing you need to know, because the two are fixed very differently.

  **Per request**, alongside the duration and at a cost of two syscalls:

  - `performance.cpu` — `user`, `system` and `total` CPU milliseconds. The Performance tab shows the share of the duration and names it: _CPU-bound_, _waiting on I/O_, or mixed.
  - `performance.memory` — `heapUsedAfter`, `rss`, and the `heapDelta` / `rssDelta` over the request. The deltas are what a leak looks like; they can be negative when a collection freed more than the request allocated.
  - `performance.eventLoop` — `utilization`, `active` and `idle` over the request's window. High utilization on a slow request means the thread was blocked.
  - `performance.gc` — collections during the request and their total pause. Reported while `runtime` is enabled, since observing GC means keeping a `PerformanceObserver` alive.

  **For the process**, a new **Runtime** view in the dashboard sidebar: memory and CPU trends, event-loop lag percentiles (p50/p99/max from `monitorEventLoopDelay`), garbage collection split by kind, the V8 heap spaces, and the process facts. Sampled on an interval, because a leak is a shape over time rather than a value on one request — which is exactly what a per-request figure cannot show.

  - New option `runtime?: boolean | { enabled?, interval?, historySize? }`, enabled by default, sampling every 5 s and keeping 120 samples. `runtime: false` stops the interval, releases the histogram and the GC observer, and removes the view.
  - New exports: `RuntimeMetricsService`, `RuntimeCollector`, `completeProfilePerformance`, `registerGcCounter`, and the `ProfilerRuntimeOptions` / `RuntimeSample` / `RuntimeCollectorData` types.
  - `GlobalPanelDescriptor` gains an optional `note`, so a panel can say what kind of data it holds. Every global panel was labelled "captured at startup", which is true of Config and Discover and not of one that samples over time.
  - The Runtime view is documented in the [Profiler UI](https://nest-profiler.eleven-labs.com/docs/profiler-ui) tour with its own screenshot, and the screenshot generator captures it — warmed up under traffic first, since an idle process yields flat lines and an empty GC table.
  - **The process-heap strip above the list pages is removed.** The Runtime view supersedes it on every axis: it sampled `heapUsed` once per profiled request — an axis made of traffic rather than time, so idle periods vanished and bursts compressed — and its leak heuristic could flip on a single collection. It also occupied the top of every list for data belonging to none of them, and cost a dedicated storage query per page load.

  Everything read comes from `node:os`, `node:v8` and `node:perf_hooks` — no dependency to install, and nothing leaves the process.

  **Read the per-request figures knowing what they are:** process-wide deltas over the profile's window, not an isolated measurement of one execution. Node runs a single thread, so under concurrent traffic a request is charged with what its neighbours spent too. That is the right trade for a tool used while driving requests one at a time, and the UI states it where the numbers are shown rather than leaving it to be discovered.

- a512259: Raise the `@nestjs/core` peer to `^11.1.4`, forward the trace id on outgoing calls, and make the trace lens reach the table under the waterfall.

  - **`@nestjs/core` peer is now `^11.1.4`**, the first release carrying the `instrument` option on `NestFactory`. A peer range only warns at install, so `createProfilerInstrument()` also checks the resolved version and says so once — on an older Nest the option is ignored and the feature is _silently_ inert, which is the worst failure mode for a debugging tool.
  - **`propagateTraceId`** on `HttpCollectorModule` forwards the profile's trace id on every instrumented outgoing call (`true` for `x-request-id`, or a header name). Off by default: adding a header to an application's outgoing traffic is a visible change. A header the caller set explicitly always wins, and nothing is added outside a profiled request.
  - **The Execution Trace lens now filters the table below the bars**, not only the bars. "I/O only" used to hide the method bars and still list every one of them underneath. Rows carry the same span id, so folds reach them too, and a count appears when you are looking at a subset.

- e374e09: Drop the Token column from every profile list, lead with Time and Duration, and make the whole row the link.

  - The **Token** column is gone from the HTTP, GraphQL, Commands and RabbitMQ lists: the token identifies the profile in the URL, in the `X-Debug-Token` header and on the detail page, so repeating a truncated copy on every row only pushed the columns that discriminate one execution from another out of the way.
  - Every list now opens on **Time** then **Duration** — when an execution happened and what it cost — before the columns specific to its kind.
  - The detail tables follow the same order: SQL queries, Mongoose queries, HTTP client calls, cache operations and the execution timeline all lead with Time then Duration, so a table reads the same wherever it sits.
  - The row is the link: no cell owns it any more. A new `row-link` client behaviour navigates on a click anywhere in a `[data-row-href]` row, opens a new tab on ctrl/meta or middle click, and follows a focused row on `Enter`. Nested interactive elements and clicks that end a text selection are left alone.
  - Custom list sections: put the profile URL in `data-row-href` on the `<tr>` and add `tabindex="0"` (a `<tr>` is not focusable on its own) to get the same behaviour.
  - The attribute is validated before it is followed: only a same-origin path navigates, never a `javascript:`, protocol-relative or cross-origin value.

- ce21258: Measure every duration on a monotonic clock, with sub-millisecond resolution.

  Elapsed time — the request duration and every timeline span — was computed from `Date.now()`, which is both millisecond-granular and non-monotonic. Two consequences: any span shorter than a millisecond reported `0ms`, which is most application work and made the execution timeline unusable for comparing phases; and a wall-clock adjustment mid-request (an NTP step) produced a wrong duration, a backward step a **negative** one, which then flowed into the `slow` performance rule, the duration list filter and the stored profile summary.

  - `PerformanceData.duration` and `TimelineSpan.duration` are now measured with `performance.now()` and carry up to three decimals (`0.42`, `1.618`). They are clamped at `0`, so a duration can never be negative.
  - Absolute timestamps are unchanged and stay on the wall clock, because they are what a reader needs: `performance.startTime`, `TimelineSpan.startedAt`, `createdAt` and every log/exception timestamp remain epoch milliseconds.
  - The HTTP middleware now reads the clock **once**: `createdAt` and `performance.startTime` named the same instant through two separate `Date.now()` calls and could disagree by a millisecond.
  - New `formatDuration` view helper, applied to every duration the UI renders (profile header and Performance tab, the execution timeline, and the HTTP / GraphQL / Command / RabbitMQ list and detail views). It trades precision against magnitude — two decimals below 10 ms, one below 100 ms, whole milliseconds above — trims trailing zeros, and renders `<0.01` for a value too small to show rather than a misleading `0`.
  - New exports: `monotonicNow`, `elapsedMs`, `markProfileStart`, `profileElapsedMs`, `formatDuration`. A package contributing its own entrypoint kind calls `markProfileStart(profile)` when it builds the profile to opt into monotonic measurement; a kind that does not falls back to the wall-clock difference, clamped at zero.

  No migration and no storage change: SQLite's numeric affinity preserves a fractional value in the existing `duration INTEGER` summary column, on existing databases as well as new ones (covered by a test).

  Anything reading `performance.duration` or `span.duration` programmatically — a custom performance rule, a custom collector panel, an assertion in a test — now receives a fractional number where it used to receive an integer.

- 6593feb: Stop persisting credentials carried in a request, and make every masking list additive.

  - **Query parameters are now masked at capture.** Both the stored URL and the parsed `query` had their values recorded verbatim, so a password-reset `token`, an OAuth `code`, a `state` or a URL `signature` was readable in the dashboard, in the `/_profiler/:token/data` export and in the _Copy as cURL_ command — and on disk for the whole `ttl` with file or SQLite storage. A built-in list (`token`, `access_token`, `refresh_token`, `id_token`, `api_key`, `code`, `state`, `signature`, `sig`, `password`, `secret`, `client_secret`, `session_id`…) is masked by default, matched case-insensitively and ignoring `-`/`_`. Parameter names are kept and only values replaced, so a captured URL still reads `?token=[REDACTED]`.
  - **`maskHeaders` extends the built-in list instead of replacing it.** `maskHeaders: ['x-tenant-token']` used to make that header the _only_ masked one, silently un-masking `authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token` and `proxy-authorization` — the opposite of what the configuration expresses. Adding a header now never drops a built-in protection.
  - **New options:** `maskQueryParams` (extra parameter names) and `useDefaultMaskQueryParams` / `useDefaultMaskHeaders` (`true` by default) to opt out of a built-in list deliberately.
  - **New exports:** `DEFAULT_MASK_QUERY_PARAMS`, `buildMaskedQueryParams`, `redactQueryString`, `redactQueryRecord`.

  Behaviour change: an application already passing `maskHeaders` now masks more headers than before, and captured URLs and query records may contain `[REDACTED]` where a value used to be. `ignoreRequest` still receives the unredacted request — it decides what gets profiled, so it must see what actually arrived.

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

- f6f00cd: Record the payload actually sent to the client when a route handler returns the response object. Controllers using `@Res()` with `return res.json(payload)` emit the Express response itself (`res.json()` returns `res`), which the interceptor stored as the response body — the profiler's Response tab showed the serialized `ServerResponse` (its `req`, sockets and raw headers) instead of the payload. The interceptor now detects that value and falls back to the body the middleware captured off `res.json()` / `res.send()`; the response-finish hook also backfills any body written after the observable completed (e.g. `res.render()`).
- 429397b: Consolidate the HTTP capture plumbing: one response finalizer, one finish hook, one header normaliser, one optional-peer loader.

  packages:

  - The core registers a single `finish` listener (the middleware's). The interceptor registered a second one that duplicated the first's safety net and could only ever guard itself against it with `if (profile.response) return`.
  - `profile.response` is built in one place, `finalizeHttpProfile()`, instead of three. The error paths now hand it the status derived from the exception rather than building a response with the transport's stale `200` and patching it afterwards.
  - Body bounds and masking are resolved once into a shared `HttpCaptureConfig`, so the request (middleware) and response (interceptor) capture cannot bound or mask differently.
  - Every header bag — incoming request, outgoing response, HTTP instrumentations — now goes through `extractHeaders()`, which gained an optional third argument: `replacement` for a custom sentinel and `multiValue` to keep a repeated header as an array. Response headers therefore gain the fuller value handling (`Headers`, `Map`, `toJSON()`, `Date`, `bigint`) the instrumentations already had.
  - The per-request transport state (`deferCollection`, the transport response-body getter) moved from `Symbol` properties on the `Profile` to a private `WeakMap`, removing the `as unknown as Record<symbol, unknown>` casts and keeping request plumbing off the profile document.
  - New public helpers `loadOptionalPeer()` / `resolveOptionalPeer()` tell **absent** (not installed, silent) from **broken** (installed but failed to load, warned) when loading an optional peer, and recover a subpath a package's `exports` map refuses — `@nestjs/core/package.json`, which Nest 12 no longer exports. `@eleven-labs/nest-profiler-config` (NestJS version) and `@eleven-labs/nest-profiler-routes` (`class-validator` metadata) now load their peers through it instead of a `try`/`catch` that swallowed everything.

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

### Minor Changes

- 0514af8: The Routes panel no longer lists the profiler's own UI/API routes (`/_profiler/...`).

  - `@eleven-labs/nest-profiler` exports `PROFILER_BASE_PATH`, the fixed base path where the profiler UI is mounted.
  - `HttpRouteSource` filters out any scanned route whose path starts with `PROFILER_BASE_PATH` before building the **REST** group.

- 74d8986: Let a global-scope collector expand into several sidebar views, and file related views under a group heading.

  `IProfilerCollector` gains an optional `expandGlobalPanels(data)` returning one `GlobalPanelDescriptor` per view — a `scope: 'global'` collector whose snapshot holds several independent subjects now becomes several sidebar views instead of one panel aggregating them. It receives the value `collect()` returned, so timeout and error handling are unchanged, and each descriptor only carries what differs from its collector (group, icon, template and priority are inherited). Returning an empty array hides the collector entirely, so an installed package with nothing to show adds no empty view.

  A global collector's `group` / `groupLabel` — previously read only for per-request panels — now files its sidebar view under that heading, and the panel header restates the group so a short label stays unambiguous (`Schemas / TypeORM`). Ungrouped views stay flat at the end of the sidebar. Global views are also ordered by collector priority, instead of by DI discovery order.

  `RouteGroup` gains an optional `itemLabel`, the singular noun a route source uses for its own entries, so a routing table counts `3 commands` rather than `3 routes` (defaults to `route`).

- 8e5df24: New `timezone` option: choose the timezone the UI renders timestamps in.

  Pages are rendered server-side, so timestamps were always projected into the timezone the process runs in — the one `TZ` selects, or the system zone when `TZ` is unset. That is right on a developer machine and wrong as soon as the application and the reader differ (a `TZ=UTC` container shows UTC times to someone in Paris). `ProfilerModule.forRoot({ timezone: 'Europe/Paris' })` now sets the display zone; any IANA name works, and an unknown one logs a warning and falls back to the host timezone. The effective timezone is displayed in the dashboard header ("Times in Europe/Paris"), so a time on screen is never ambiguous even when nothing is configured. Only rendering is affected — stored profiles keep their epoch timestamps and the JSON export is unchanged.

- 74d8986: Merge the Timeline tab into **Performance**, and show the execution timeline only when spans were recorded.

  The Timeline tab badged the request duration and, for the vast majority of profiles, rendered nothing but "No spans recorded. Use profilerService.startSpan('phase') to instrument your code." — an empty tab restating what the Performance tab already owned. The **Performance** tab now carries the whole timing story: it is badged with the total duration, keeps the duration / process-heap cards and the start-end **Timestamps**, and appends the **Execution timeline** (synchronized bars plus the per-phase table) when — and only when — the profile actually recorded spans. A profile with no span shows no timeline at all.

  The `timeline.png` screenshot is retired with the tab — the regenerated `performance.png` now carries the spans, so the two would have been the same shot of the same profile.

  `TimelineCollector` is removed from the public API: it only forwarded `profile.spans`, which the Performance tab reads directly, so nothing consumed it. Custom timeline instrumentation is unchanged — `ProfilerService.startSpan(...)` still records spans, and `profile.spans` still carries them in the exported JSON.

- 0044e45: Describe non-HTTP route inputs with their own labels in the Routes panel, instead of borrowing **Query params**.

  **Core:** `RouteInputs` gains a `groups?: RouteInputGroup[]` field — a list of `{ label, items }` sections whose items are `{ name, description?, required?, defaultValue? }` — and `RouteEntry` gains an optional `description`. Both new types (`RouteInputGroup`, `RouteInputItem`) are exported. The panel renders each group as its own titled section (documented items as a name/description list, bare names as chips) and the route description above the inputs.

  **Commander:** the **Commands** group now lists each command's description (from `@Command({ description })`), its positional **Arguments** (split from `@Command({ arguments })`, documented via `argsDescription`, `<required>` marked) and its **Options** (from `@Option()`, with the description, default value and required marker) — previously only the long `--flag` names, mislabelled as _Query params_. Short-only options such as `-q` are now listed too, with their full flags string as the displayed name.

  **GraphQL:** field arguments now render under an **Arguments** label, and a field's schema description is surfaced on the route.

  The Commands list no longer prints `exit 0` next to the `OK` status — the status already says it. The exit code remains on the **Command** detail tab.

- 74d8986: Make the home page's sidebar identical to a profile's, and give each subject exactly one glyph.

  The two navigations had drifted into two components: the home page indented its items further (`pl-6` against the detail page's `pl-3`), used a thinner separator and its own header padding, rendered a flat count badge where the detail page accents the active one, and carried no icon at all on the **Profiling** items. Both now share one nav-item partial — same padding, same badge scale, same active accent — and both render the icon in a fixed-width slot, so an item that declares no icon still lines its label up with the others.

  `ProfilerListSection` gains an optional `icon`. A protocol now keeps **one** glyph everywhere it is named, across both pages: the HTTP globe is defined once in the core (exported as `HTTP_ICON`) and used by the HTTP list section, the HTTP routing table and the HTTP Client collector panel; the GraphQL mark serves both the GraphQL list section and the GraphQL detail tab. That retires two near-duplicate marks — a second terminal glyph for Commands and a second GraphQL glyph — which existed only because each file defined its own copy. Tabs naming a _content_ rather than a protocol (Request, Response, Message, Performance…) keep their own icon.

  The HTTP routing table is labelled **HTTP** rather than **REST**, so the sidebar names the protocol once: `Profiling / HTTP` and `Discover / HTTP`, same word, same globe. `RouteGroup.label` for the built-in source changes accordingly; the `?view=discover-http` key is unchanged.

### Patch Changes

- 74d8986: Move the process-heap trend above the page title on the profiler home page.

  The trend was rendered inside the active list view, next to the HTTP / GraphQL / Command list it happened to be shown with — which read as "the heap of these profiles" when it is process-wide data, sampled at request start across the 30 most recent profiles regardless of entrypoint. It now sits above the **Recent Profiles** heading, and shows on the global panel views too instead of disappearing whenever a non-list view was open.

- 8e5df24: Render profile timestamps in the host timezone instead of UTC.

  The `isoDate` / `timeOnly` template helpers formatted epoch milliseconds with `toISOString()`, so every date shown in the UI — the list sections, the detail header, the timeline, the log/exception rows and every collector panel (SQL, Mongoose, HTTP client, cache, validator, RabbitMQ) — was shifted by the host's UTC offset (a profile captured at 20:00 in `Europe/Paris` displayed as 18:00), while the Config panel reported the runtime timezone. They now format in the timezone the process runs in, so the times shown match the reported timezone.

## 1.0.0-alpha.15

### Patch Changes

- bdbcba1: Profile the AMQP messages an application **publishes**, not just the ones it consumes.

  - New `RabbitMqPublishCollectorModule.forRoot()` / `.forRootAsync()` adds an **AMQP** panel listing every `AmqpConnection.publish` made while a profile was active: exchange, routing key, AMQP properties (`messageId`, `appId`, `correlationId`, `replyTo`), masked headers, captured payload, duration and outcome — plus a copy button holding a runnable `channel.publish(...)` snippet. Options: `enabled`, `captureHeaders`, `captureBody`, `maskHeaders`, `payloadLimits`, `slowThreshold`, `nPlusOneThreshold`, `chattyThreshold`, the matching severities and `error`.
  - Entries are tagged by the core rule engine in a new `amqp` domain, so a publish repeated once per loop iteration surfaces as N+1, a slow broker write as `slow`, and a rejected publish as `error`. A message the channel buffered (`publish()` resolving to `false`) is reported as `buffered` rather than an error. New public `AmqpPublishEntry` type.
  - The module is independent of `RabbitMqCollectorModule`: a publish-only API registers just this one, a consumer just the other, and an application doing both gets the publishes of its consumers listed on their message profiles. It works under any entrypoint (HTTP request, CLI command, consumed message) since the panel is profile-scoped. `nestjs-cls` joins the package's peer dependencies, as in every other collector package.
  - Core: the built-in performance rules no longer hardcode `query`/`request` wording — the N+1 detail and the default `chattyThreshold` are resolved per rule domain, so a non-query collector reads correctly ("Same message executed 3 times").

## 1.0.0-alpha.14

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.13

### Minor Changes

- 33fe3cb: Make the body-capture truncation limits fully configurable, and allow capturing an untruncated body.

  The inner content caps applied to every captured request/response body (`maxStringLength`, `maxItems`, `maxDepth`) were hard-coded and never exposed, so `maxBodySize: 0` looked like it disabled truncation but the body content was still cut. They are now configurable via the new `bodyCaptureLimits` module option and threaded through the middleware and interceptor (request **and** response) to `normalizeBody` / `toSafeData`.

  Each cap — including `maxBodySize` — can be disabled individually with `0` (or a negative value); disabling all of them captures the full body verbatim. Defaults are unchanged (64 KB / 2048 / 64 / 4), so behaviour is identical without opting in. The truncation marker's `_note` no longer claims the raw JSON export holds the full body, since the full body is never persisted — it now points at raising or disabling the caps instead.

- 4ebf169: Add on-demand SQL `EXPLAIN` plan analysis to the Database panel.

  Every query in the SQL panel now has an **Explain** button. Clicking it runs `EXPLAIN` for that single query over the ORM's own connection and renders the execution plan inline — top plan node, a warning when the plan does a full-table (sequential) scan, the scanned relations, estimated rows/cost, and the raw plan. Supported dialects: PostgreSQL, MySQL/MariaDB and SQLite.

  The analysis runs **on demand only** — nothing executes until a user clicks — so it adds no latency to the profiled request. `EXPLAIN` alone does not execute the statement; the opt-in `analyze` variant (`EXPLAIN ANALYZE`) does, and is restricted to `SELECT`.

  - core: new `ExplainRunnerRegistry`, dialect-aware `parseExplainPlan` helper, `ExplainOptions`/`ExplainPlan`/`ExplainRunner` types, a secured `GET /_profiler/:token/explain/:collector/:index` route rendering the plan fragment, and the SQL panel UI (Explain button, seq-scan badge, collapsible raw plan).
  - `nest-profiler-typeorm` / `nest-profiler-mikro-orm`: new `explain?: ExplainOptions` module option (default `{ enabled: true }`) and an EXPLAIN runner that executes over the DataSource / EntityManager connection and registers with the core registry.

### Patch Changes

- 30e97ef: Serialize non-plain values meaningfully in `toSafeData()` instead of collapsing them to `'[Object]'`.

  - `toSafeData()` (used for captured log payloads, request/response bodies, and any `safeStringify` sink) fell through to the literal `'[Object]'` for every object that was not a plain object, `Error`, `Date`, `Map`, `Set` or typed array. A logged `URL`/`URI` therefore rendered as `"uri": "[Object]"`, and `RegExp` and other class instances were collapsed the same way — the exact bug already fixed in `redact()`.
  - `URL`/`RegExp` are now stringified (`URL` → its href, `RegExp` → its source form), aligned with `redact()`.
  - Remaining class instances prefer their `toJSON()` projection when present, else fall back to own-enumerable enumeration (capped by `maxItems`) instead of being dropped as `'[Object]'`.

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
