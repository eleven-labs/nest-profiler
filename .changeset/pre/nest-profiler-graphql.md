---
'@eleven-labs/nest-profiler-graphql': patch
---

First public npm (alpha) release. `@eleven-labs/nest-profiler-graphql` adds GraphQL profiling to `@eleven-labs/nest-profiler`:

- `ProfilerGraphQLModule` captures GraphQL queries, mutations, and subscriptions for Apollo Server (Express/Fastify), Mercurius (Fastify), and graphql-yoga.
- Built on the core context-adapter extension point, so GraphQL operations are profiled like HTTP requests.
- `ignoreGraphQLPlayground` — skips `GET /graphql` with `Accept: text/html` (the Apollo Sandbox page load).
- `ignoreGraphQLIntrospection` — skips requests with `operationName: IntrospectionQuery` or a query body referencing `__schema` / `__type`.
