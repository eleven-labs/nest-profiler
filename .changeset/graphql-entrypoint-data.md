---
'@eleven-labs/nest-profiler-graphql': minor
---

GraphQL operations are now their own first-class **entrypoint type** rather than a sub-mode of HTTP: they render in a dedicated **GraphQL** list table and a **GraphQL** detail tab (operation, query, variables and response), with their own filter bar including an **Operation** filter (query / mutation / subscription).

- `GraphQLContextAdapter` writes the operation metadata into `entrypoint.data.graphql` (idempotently, so the interceptor can call it per resolver) and flips the profile's `entrypoint.type` from `http` to `graphql`.
- `ProfilerGraphQLModule` registers the `graphql` entrypoint type with the profiler core on init.
- New exports: `GRAPHQL_ENTRYPOINT_TYPE`, `GRAPHQL_ENTRYPOINT_TYPE_DEF` and the `GraphQLEntrypointData` type (an `HttpRequestData` with a guaranteed `graphql`).
