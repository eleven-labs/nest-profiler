# @eleven-labs/nest-profiler-commander

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

### Patch Changes

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

- ce21258: Measure every duration on a monotonic clock, with sub-millisecond resolution.

  Elapsed time — the request duration and every timeline span — was computed from `Date.now()`, which is both millisecond-granular and non-monotonic. Two consequences: any span shorter than a millisecond reported `0ms`, which is most application work and made the execution timeline unusable for comparing phases; and a wall-clock adjustment mid-request (an NTP step) produced a wrong duration, a backward step a **negative** one, which then flowed into the `slow` performance rule, the duration list filter and the stored profile summary.

  - `PerformanceData.duration` and `TimelineSpan.duration` are now measured with `performance.now()` and carry up to three decimals (`0.42`, `1.618`). They are clamped at `0`, so a duration can never be negative.
  - Absolute timestamps are unchanged and stay on the wall clock, because they are what a reader needs: `performance.startTime`, `TimelineSpan.startedAt`, `createdAt` and every log/exception timestamp remain epoch milliseconds.
  - The HTTP middleware now reads the clock **once**: `createdAt` and `performance.startTime` named the same instant through two separate `Date.now()` calls and could disagree by a millisecond.
  - New `formatDuration` view helper, applied to every duration the UI renders (profile header and Performance tab, the execution timeline, and the HTTP / GraphQL / Command / RabbitMQ list and detail views). It trades precision against magnitude — two decimals below 10 ms, one below 100 ms, whole milliseconds above — trims trailing zeros, and renders `<0.01` for a value too small to show rather than a misleading `0`.
  - New exports: `monotonicNow`, `elapsedMs`, `markProfileStart`, `profileElapsedMs`, `formatDuration`. A package contributing its own entrypoint kind calls `markProfileStart(profile)` when it builds the profile to opt into monotonic measurement; a kind that does not falls back to the wall-clock difference, clamped at zero.

  No migration and no storage change: SQLite's numeric affinity preserves a fractional value in the existing `duration INTEGER` summary column, on existing databases as well as new ones (covered by a test).

  Anything reading `performance.duration` or `span.duration` programmatically — a custom performance rule, a custom collector panel, an assertion in a test — now receives a fractional number where it used to receive an integer.

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

## 1.0.0-alpha.16

### Major Changes

- 0044e45: Stop collecting a command's exit code.

  **BREAKING:** `CommandInfo.exitCode` is removed, and the **Command** tab no longer shows an _Exit Code_ card. The field was never observed — the collector wraps `run()` from inside the process, so it cannot know the code the CLI eventually exits with; it was derived as `error ? 1 : 0`, saying exactly what `success` already said. Read `entrypoint.data.success`, or the profile's `response.statusCode` (`200` / `500`), instead.

### Minor Changes

- 0044e45: Describe non-HTTP route inputs with their own labels in the Routes panel, instead of borrowing **Query params**.

  **Core:** `RouteInputs` gains a `groups?: RouteInputGroup[]` field — a list of `{ label, items }` sections whose items are `{ name, description?, required?, defaultValue? }` — and `RouteEntry` gains an optional `description`. Both new types (`RouteInputGroup`, `RouteInputItem`) are exported. The panel renders each group as its own titled section (documented items as a name/description list, bare names as chips) and the route description above the inputs.

  **Commander:** the **Commands** group now lists each command's description (from `@Command({ description })`), its positional **Arguments** (split from `@Command({ arguments })`, documented via `argsDescription`, `<required>` marked) and its **Options** (from `@Option()`, with the description, default value and required marker) — previously only the long `--flag` names, mislabelled as _Query params_. Short-only options such as `-q` are now listed too, with their full flags string as the displayed name.

  **GraphQL:** field arguments now render under an **Arguments** label, and a field's schema description is surfaced on the route.

  The Commands list no longer prints `exit 0` next to the `OK` status — the status already says it. The exit code remains on the **Command** detail tab.

### Patch Changes

- 74d8986: Replace the single **Routes** panel with one **Discover** view per transport.

  "Routes" named the panel after one transport's vocabulary while listing four, and answered a question nobody asks that way: you look up the HTTP table, or the CLI's commands, not "all routes". Each registered `ProfilerRouteSource` now contributes its own sidebar view under a **Discover** heading — `Discover / HTTP`, `Discover / GraphQL`, `Discover / Commands`, `Discover / RabbitMQ` — each rendering that transport's table flat, with no group disclosure to open first, and counting its entries with the source's own noun (`4 commands`, `9 fields`). A transport that discovered nothing gets no view, so the sidebar lists only what the application actually registered.

  The `routes.png` screenshot is renamed `discover.png` and reshot on the HTTP view. The views are ordered deterministically — the built-in HTTP source first, then the other transports by label — instead of following the DI bootstrap order, which shuffled the sidebar between runs. They are keyed `discover-<transport>` in `?view=`, so they can never collide with the same-protocol profile list: `?view=graphql` stays the GraphQL list, `?view=discover-graphql` is its routing table. `discoverViewKey()`, `DISCOVER_GROUP` and `DISCOVER_GROUP_LABEL` are exported for consumers building their own links. The GraphQL, RabbitMQ and Commands sources declare the `itemLabel` their entries deserve; nothing else changes in how a source is registered.

- 1afa95c: Profile a command that fails before its `run()` is entered. The collector only wrapped `CommandRunner.run()`, but nest-commander evaluates the `@Option()` value parsers while commander parses the argv — i.e. before the action handler — so a parser that rejects its input (`throw new Error('Unknown site parameter')`) aborted the invocation outside the wrapper and the failed command left **no profile at all**: nothing in the Commands list, nothing under the Status "Failed" filter, while the same command succeeding was profiled normally.

  - Each `@Option()` value parser is now wrapped as well: a parser that throws produces a failed command profile (`success: false`, status `500`) carrying the thrown error in the **Exceptions** tab, then the error is rethrown untouched so the CLI behaves exactly as before.
  - Such a profile records the options commander had resolved so far (declared defaults included) plus the **raw** value the rejected flag was given — no parsed value exists for it — and empty `arguments`, since commander assigns the positional operands only once every option has parsed.
  - Persistence goes through the core's deferred queue (`schedulePersist`), drained on application shutdown, because commander's parse phase is synchronous and cannot await a save.

  Commander's own argv errors — an unknown option, a missing required option, an invalid `choices` value, or a parser throwing commander's `InvalidArgumentError` — still leave no profile: commander prints a CLI error and calls `process.exit()` itself, so nothing survives to persist one. This is now documented in the package README and in the troubleshooting guide.

- 1afa95c: Drop the explainers appended to the **Arguments** and **Options** headings of the Command tab. They restated the runner signature (`— positional operands (run(passedParams))`, `— parsed --flags (run(_, options))`) on every profile, competing with the values below them; the two headings now read `Arguments` and `Options`. What each one holds is documented on the package page, not repeated in the panel.
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

### Patch Changes

- d34fefe: Update supported peer dependency ranges and test dependencies for current NestJS 11-compatible releases, including `nestjs-cls` 6, Mongoose 9, and TypeORM 1.

## 1.0.0-alpha.5

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.4

### Minor Changes

- 9523bad: Own the command profile shape and its UI instead of relying on core types.

  `CommandProfiler` now builds a `command` entrypoint (`entrypoint.type = 'command'`, the command details on `entrypoint.data`). The package exports its own `CommandInfo` type and `COMMAND_ENTRYPOINT_TYPE`, and `CommanderCollectorModule` registers a `command` entrypoint type with the profiler core — contributing the Commands list table, the **Command** detail tab and a **Status** (success / failed) filter above the Commands list. Import the module in your HTTP app too when you want command profiles produced by the CLI process (shared via file storage) to render in its web profiler.

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

- ff89de2: First public npm (alpha) release. `@eleven-labs/nest-profiler-commander` profiles CLI commands built with [nest-commander](https://nest-commander.jaymcdoniel.dev/) — the console equivalent of Symfony's command profiling:
  - Automatically profiles every nest-commander command, with no changes to your command classes.
  - Each run produces a profile (shown alongside HTTP profiles at `/_profiler`) with the command name, positional arguments, parsed options, duration, and exit code.
  - Runs the command body inside the profiler's CLS context, so other collectors (HTTP client, cache, database, …) capture the activity a command triggers.
  - Sets `request.command` so the UI renders commands in a dedicated **Commands** table and **Command** tab.
  - Exceptions thrown by a command are captured and the profile is marked as failed (HTTP-equivalent status `500`).
  - `enabled` option (no providers when `false`) and `CommanderCollectorModule.forRoot()`; optional peer dependency on `nest-commander` (no-op when absent).

- Updated dependencies [ff89de2]
  - @eleven-labs/nest-profiler@0.5.1-alpha.0
