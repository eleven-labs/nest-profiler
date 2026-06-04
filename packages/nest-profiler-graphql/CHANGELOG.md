# @eleven-labs/nest-profiler-graphql

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

## 0.0.1

Initial release. GraphQL support for `@eleven-labs/nest-profiler` — Apollo Server (Express/Fastify), Mercurius (Fastify) and graphql-yoga.
