# @eleven-labs/nest-profiler

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
