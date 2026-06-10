# @eleven-labs/nest-profiler-graphql

## 1.0.0-alpha.2

### Patch Changes

- f9ebe84: Parse GraphQL HTTP bodies with the `graphql` package (now declared as a peer dependency) instead of regex-based field detection, removing the regex backtracking risk on crafted queries.

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

### Patch Changes

- Updated dependencies [e4822c6]
  - @eleven-labs/nest-profiler@1.0.0-alpha.1

## 0.5.1-alpha.0

### Patch Changes

- ff89de2: First public npm (alpha) release. `@eleven-labs/nest-profiler-graphql` adds GraphQL profiling to `@eleven-labs/nest-profiler`:
  - `ProfilerGraphQLModule` captures GraphQL queries, mutations, and subscriptions for Apollo Server (Express/Fastify), Mercurius (Fastify), and graphql-yoga.
  - Built on the core context-adapter extension point, so GraphQL operations are profiled like HTTP requests.
  - `ignoreGraphQLPlayground` — skips `GET /graphql` with `Accept: text/html` (the Apollo Sandbox page load).
  - `ignoreGraphQLIntrospection` — skips requests with `operationName: IntrospectionQuery` or a query body referencing `__schema` / `__type`.

- Updated dependencies [ff89de2]
  - @eleven-labs/nest-profiler@0.5.1-alpha.0
