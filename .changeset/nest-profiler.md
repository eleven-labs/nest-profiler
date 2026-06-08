---
'@eleven-labs/nest-profiler': patch
---

First public release on the npm registry, shipped as an alpha prerelease with build provenance. Install with `pnpm add @eleven-labs/nest-profiler@alpha`.

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
