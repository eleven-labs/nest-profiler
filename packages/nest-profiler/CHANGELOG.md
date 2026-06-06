# @eleven-labs/nest-profiler

## 0.4.0

### Minor Changes

- 88a9794: Add a configurable per-collector timeout via the `collectorTimeout` option (default `1000`ms; set `0` to disable).

  A slow or hanging collector can no longer block the response or the profiler list page: once the timeout elapses the panel stores `{ error: 'timed out after <n>ms' }` and a warning is logged. Fast collectors are unaffected.

- 88a9794: Add a `token` option to `ProfilerModule.forRoot()` for securing the profiler UI.

  The guard now resolves the bearer token as `options.token ?? process.env.PROFILER_TOKEN`, so it can be configured through module options instead of only the environment — keeping packages free of direct `process.env` reads. Fully backward compatible: the `PROFILER_TOKEN` environment variable still works.

### Patch Changes

- 88a9794: Surface collector failures instead of hiding them. A failing collector now logs a warning and stores its real error message (rather than a generic `Collection failed`), and global-panel collection is guarded too, so a throwing global collector can no longer bubble out of the controller.
- 88a9794: Fix the profiler list hiding every profile when a numeric filter received invalid input. Query params are now normalized through a dedicated, validation-library-agnostic pipe, so a bad value such as `?statusCode=abc` is ignored instead of producing a `NaN` filter that matched nothing.

## 0.3.0

### Minor Changes

- 09586a0: Support CLI command profiles in the web UI and make file storage reflect other processes:
  - New `request.command` field (`CommandInfo`) so a profile can describe a CLI command instead of an HTTP request. The list page shows a dedicated **Commands** table, and the detail page renders a built-in **Command** tab (no request/response tabs) for these profiles.
  - `FileStorageAdapter` now reconciles its in-memory index with the directory on every read, so profiles written by another process (e.g. a CLI command run while the web server is up) appear without restarting — and files removed externally drop out.
  - Added an optional `crossProcess` capability to `IProfilerStorageAdapter` (`MemoryStorageAdapter` → `false`, `FileStorageAdapter` → `true`) so tooling can detect process-local stores.

## 0.2.0

### Minor Changes

- 8980be8: Add `@eleven-labs/nest-profiler-mikro-orm`, a MikroORM query collector that captures SQL queries in the Database panel via the ORM logger. The package ships as ESM-only (`"type": "module"`), matching `@mikro-orm/core` and `@mikro-orm/nestjs` v7 which are ESM-only — it must be consumed from an ESM host.

  Introduce a shared `AbstractSqlQueryCollector` base (plus `QueryEntry`/`QueryType`/`detectQueryType` and the `sql-panel.ejs` template) in `@eleven-labs/nest-profiler` so SQL ORM collectors reuse the rendering contract. The TypeORM collector now extends this base (no public API change).

## 0.1.0

### Minor Changes

- 4a1586e: Add GraphQL collector and context-adapter extension point

  **`@eleven-labs/nest-profiler-graphql`** (new package)
  - `ProfilerGraphQLModule` — captures GraphQL queries, mutations and subscriptions for Apollo Server (Express/Fastify), Mercurius (Fastify) and graphql-yoga
  - `ignoreGraphQLPlayground` — filter that skips `GET /graphql` with `Accept: text/html` (Apollo Sandbox page load)
  - `ignoreGraphQLIntrospection` — filter that skips requests with `operationName: IntrospectionQuery` or a query body referencing `__schema` / `__type`

  **`@eleven-labs/nest-profiler`**
  - New exports: `IContextAdapter`, `PROFILER_CONTEXT_ADAPTERS`, `PROFILER_REQ_KEY` — extension point for profiling non-HTTP contexts (GraphQL, gRPC, WebSockets, …)
  - New exports: `combineFilters`, `ProfilerFilterRequest`, `ProfilerRequestFilter` — OR combinator for composing `ignoreRequest` predicates
  - New option `ProfilerModuleOptions.ignoreRequest` — custom predicate to skip profiling individual requests after `ignorePaths` checks
  - New export: `ProfilerCoreService` — allows context adapters registered by third-party modules to enrich profiles
  - New type export: `GraphQLInfo` on the `Profile` interface

- 4a1586e: Make log capture logger-agnostic via transparent Proxy

  `ProfilerService.createLogger` now wraps any logger (NestJS `LoggerService`, nestjs-pino `PinoLogger`, or any custom logger) in a transparent `Proxy` instead of a fixed class. Level methods are intercepted and forwarded to the profiler; all other methods and properties pass through to the delegate unchanged, preserving the original return type.
  - New exports: `createProfilerLogger`, `DEFAULT_LOG_METHODS`, `LogMethodMap`
  - `DEFAULT_LOG_METHODS` covers standard NestJS levels (`log`, `error`, `warn`, `debug`, `verbose`, `fatal`) plus common third-party aliases (`info` → `log`, `trace` → `verbose`)
  - Pass a custom `LogMethodMap` to `createProfilerLogger` for other loggers
  - Directly-injected loggers (e.g. nestjs-pino `PinoLogger` via `@Optional()`) can now be wrapped with `createProfilerLogger` to capture their calls even when they bypass `app.useLogger()`

## 0.0.1

### Features

- Initial release: NestJS web profiler inspired by Symfony's Web Profiler
- Per-request profiling with unique token (UUID v4) and floating toolbar injected into HTML responses
- Built-in profiler UI at `/_profiler` — list, detail view, filters, and JSON export
- Built-in **Timeline** panel with `startSpan()` / `stop()` API for custom performance phases
- Built-in **Request**, **Response**, **Performance**, **Logs**, and **Exceptions** panels
- Extensible collector architecture via `@ProfilerCollector()` decorator and `IProfilerCollector` interface
- Collector grouping — share a sidebar tab across multiple independent collectors with `group` key
- Two storage backends: in-memory LRU (`storageType: 'memory'`, default) and file-based (`storageType: 'file'`)
- Custom storage via `IProfilerStorageAdapter` interface
- `ProfilerModule.forRoot()` and `ProfilerModule.forRootAsync()` configuration
- Options: `enabled`, `path`, `maxProfiles`, `ttl`, `isGlobal`, `storageType`, `storagePath`, `storage`, `collectBody`, `sampleRate`, `ignorePaths`, `maskCookies`
- Debug headers: `X-Debug-Token`, `X-Debug-Token-Link`, `X-Profiler-Token`
- Log capture via `profilerService.createLogger()`
- Platform-agnostic: supports both `@nestjs/platform-express` and `@nestjs/platform-fastify`
- Nav items grayed out when a collector has no data for the current request
