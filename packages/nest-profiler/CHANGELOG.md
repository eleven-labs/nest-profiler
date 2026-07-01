# @eleven-labs/nest-profiler

## 1.0.0-alpha.7

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
