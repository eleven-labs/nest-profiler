# @eleven-labs/nest-profiler

## 1.0.1

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
