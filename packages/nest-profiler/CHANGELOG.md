# @eleven-labs/nest-profiler

## 1.6.0

### Minor Changes

- 4621ad2: Show the Mongoose schema as documents rather than relational tables. The Schemas / Mongoose panel now lists embedded documents, arrays of subdocuments and nested objects under the field holding them, finds the references declared inside them, and names references `ref` / `ref[]` instead of a relational cardinality (`many-to-one` / `one-to-many`). A reference is now also listed as a field, and arrays show their element type (`String[]`). The panel opens with a Mermaid **Document diagram**: one block per model and embedded document, solid lines for embedding and dashed lines for references, and a shape embedded in several places (an address used for shipping and billing) drawn once. Schema collectors can declare a `document` data model, which switches the panel to fields, required and references.

## 1.5.0

### Minor Changes

- 4d65fca: Make the Schemas panel's entity relationship diagram navigable: it is drawn in a pan/zoom viewport (drag to pan, Ctrl/⌘ + scroll, pinch or double-click to zoom), with a toolbar to zoom, return to 100 %, fit the diagram or expand it to the full window, keyboard shortcuts, and a **Go to entity** picker that centres and highlights an entity.

## 1.4.0

### Minor Changes

- 68a0421: Ship an ESM build alongside the CommonJS one. The exports maps serve `import` from `dist/esm` and `require` from `dist`. A CommonJS application, which NestJS 12 keeps supporting, resolves the same CommonJS build as before. An ESM application now imports ESM throughout: on NestJS 12, whose packages are ESM, the profiler no longer makes it go through Node's `require()` of ES modules, which some runtimes turn off (see the [NestJS migration guide](https://docs.nestjs.com/migration-guide#esm-packages)).

  `@eleven-labs/nest-profiler-mikro-orm`, ESM only until now, gets a CommonJS build too, so every package resolves to the same module system as the application that loads it.

- 37746d8: Support NestJS 12 alongside NestJS 11. The peer ranges now accept both majors:

  - `@nestjs/common` and `@nestjs/core`: `^11.0.0 || ^12.0.0` (the core package keeps its `^11.1.4` floor on `@nestjs/core`, required by the `instrument` option).
  - `@nestjs/graphql`: `^13.0.0 || ^14.0.0`.
  - `@nestjs/config`: `^4.0.0 || ^12.0.0`.
  - `@nestjs/cache-manager`: `^3.0.0 || ^12.0.0`.
  - `@nestjs/event-emitter`: `^3.0.0 || ^12.0.0`.
  - `@nestjs/mongoose`: `^11.0.0 || ^12.0.0`.

  No code change is needed on the application side: install the NestJS 12 versions of these packages and the profiler keeps working. On NestJS 12, `@mikro-orm/nestjs` needs 7.1 or later and `@golevelup/nestjs-rabbitmq` 9.1 or later: earlier versions reject NestJS 12 in their own peer ranges.

  NestJS 12 ships its packages as ESM and keeps supporting CommonJS applications, which load them through Node's `require()` of ES modules (Node.js 22.12 or newer). The profiler packages ship CommonJS and load NestJS 12 the same way: a CommonJS application stays CommonJS.

- 8426b0a: Draw the TypeORM and MikroORM schemas as a Mermaid entity relationship diagram in the Schemas panel. Mermaid is loaded from jsDelivr, version-pinned and integrity-checked, only once the diagram is opened; a **Copy Mermaid** button exports the source.

## 1.3.0

### Minor Changes

- d8da9ff: List the profiles sharing a trace id on the detail page, and let the Logs tab merge the lines of the whole trace, naming the profile each one comes from.

### Patch Changes

- 1d604a6: Close a failing HTTP profile once the exception filters have answered: the profile now records the status and body the filter wrote (a domain error answered 409 was stored as 500, with no body) and keeps the lines the filter logged.
- 1d604a6: Capture the syslog levels (`notice`, `warning`, `crit`, `critical`, `alert`, `emerg`, `emergency`) in `DEFAULT_LOG_METHODS`, so a logger exposing them no longer loses those lines from the profile.

## 1.2.1

### Patch Changes

- 18c1e52: Support `nestjs-cls` 7: the peer dependency now accepts `^6.0.0 || ^7.0.0`.

  With `nestjs-cls` 7, the MikroORM collector captured no queries. `nestjs-cls` now ships an ESM build next to its CommonJS one, so the `ClsService` this ESM package imported was not the class the core registered, and resolving it found nothing. The collector now reads the request context through `ClsServiceManager`, which `nestjs-cls` shares between its two builds.

## 1.2.0

### Minor Changes

- c7c78e3: Record what each model call exchanged with its provider. The new opt-in `providerPayload` capture field stores the request body the AI SDK sent and the response headers and body the provider answered before the SDK normalised them — plus the endpoint, status and error body of a refused call — read from the provider's own result inside the registered telemetry integration, so no call site needs `include`. The HTTP request a model call makes now nests under that call in the trace when `@eleven-labs/nest-profiler-http`'s fetch adapter is installed. `generateText`'s `output` setting (`Output.object()`…), which replaces the deprecated `generateObject`, now records its strategy, schema, name and parsed object like `generateObject` did. The core gains `runAsSpanParent`, an `id` option on `entriesToSpans`, and exports `DEFAULT_SECRET_KEY_RE`.

### Patch Changes

- f468d24: Keep the profiler's routes out of the host's Swagger document. `ProfilerController` now carries the metadata `@nestjs/swagger`'s `@ApiExcludeController()` sets, so `SwaggerModule.createDocument()` skips every `/_profiler` route without the application excluding them — and without the profiler depending on `@nestjs/swagger`.

## 1.1.0

### Minor Changes

- e0d53f6: Profile streamed responses — Server-Sent Events, LLM token streams, NDJSON, piped files. A streaming handler returns in microseconds while the transport keeps writing for seconds, so such a request used to be filed with the duration of _starting_ the stream, with one chunk recorded as its whole body, and with its collectors drained before the stream had done any work. An `@Sse()` endpoint was worse: NestJS flattens the handler's Observable into the interceptor chain, so the profile was finalized, collected and stored once per event.

  A handler that takes the response over with `@Res()` is now recognised from its own route metadata — the same check NestJS makes to decide it must write nothing itself — rather than from whether headers happen to be out already. It matters for the shape an LLM endpoint takes: the handler returns, the model answers a moment later, and only then does anything reach the wire. Such a profile used to be closed and collected before the first byte, so everything the stream recorded — the outgoing calls, the queries, the model calls — was lost even though the delivery figures were not.

  The profile is now closed when the response really ends, and `profile.response.stream` describes the delivery: chunk count, bytes, time to first chunk, how long the stream ran, the mean gap between chunks, and whether the client hung up mid-stream (an aborted stream is saved too — it never fires `finish`). The Response tab renders all of it. Anything recorded while the stream was running — an outgoing call, a query, a `tracer.span()` — now reaches the collector panels.

  Nothing changes in an application: the figures come from the transport's own `write`/`end` calls, which the profiler already wrapped, at a cost of two integer additions per chunk and two clock readings per stream. Every wrapper forwards its arguments and return value untouched, so `res.write()` keeps signalling backpressure, and nothing is buffered from a stream.

### Patch Changes

- a0f3e31: Fix `SqliteStorageAdapter` failing to open a remote libSQL database: the schema version is now recorded in a `profiler_meta` table instead of the `user_version` pragma, which hosted libSQL servers (Turso) reject over the remote protocol with `SQL_PARSE_ERROR`. Existing stores are recreated once on open, as for any schema version change.

## 1.0.0

### Major Changes

- 3a507ec: First stable release. `@eleven-labs/nest-profiler` is a Symfony-Web-Profiler-inspired profiling toolkit for NestJS: every profiled execution receives a token, and everything collected about it is inspectable at `/_profiler/{token}`.

  - **Built-in panels** — Request, Response, Performance, Logs and Exceptions, plus a **Runtime** view sampling process memory, CPU, event-loop lag and garbage collection on an interval.
  - **Unified execution trace** — the entrypoint, framework phases, queries, outgoing calls and your own spans on a single waterfall, nested by causality. `TracerService`, the `@Span` decorator, `runInSpan()` and `createProfilerInstrument()` cover the manual, functional and automatic cases; `exclude` keeps the noisy providers off the trace.
  - **Performance tags** — a rule engine flags slow queries, N+1, chatty endpoints, large payloads and zero-row writes, each configurable per domain and filterable from the list page.
  - **Extensible by design** — `IProfilerCollector` adds a panel, `ProfilerListFilter` a list filter, `IContextAdapter` a new transport, `ProfilerEntrypointType` a whole new kind of entrypoint, and `ProfilerDiscoverSource` a Discover view. `buildCollectorModule()` gives a collector package the same module shape as the first-party ones.
  - **Configurable error definition** — what counts as an error is per entrypoint kind and redefinable through `error.classify` / `error.httpStatus` / `error.exceptions`. The default is a status >= 500, or a captured exception when no status was recorded.
  - **Three storage backends** — in-memory LRU (default), file-based persistence that survives restarts, and a first-party SQLite adapter at `@eleven-labs/nest-profiler/sqlite` that filters and paginates in the database. Custom backends implement `IProfilerStorageAdapter`.
  - **Security** — the UI is gated by `ProfilerGuard` behind a pluggable `authorize` hook, and a single `redaction` block masks cookies, headers and query parameters across everything the profiler stores.
  - **Overhead controls** — `sampleRate`, `ignorePaths`, `ignoreRequest`, a per-collector `collectorTimeout` so a slow collector can never block the response, and `ProfilerNoopModule` for a production build that never loads the profiler.

  Logger-agnostic (`createProfilerLogger` wraps any logger) and platform-agnostic (Express and Fastify). Requires Node >= 22 and NestJS 11, with `nestjs-cls`, `reflect-metadata` and `rxjs` as peer dependencies.

  Documentation: https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler
