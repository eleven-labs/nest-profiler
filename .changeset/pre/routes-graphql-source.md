---
'@eleven-labs/nest-profiler-graphql': minor
---

Contribute a **GraphQL** group to the Routes panel (`@eleven-labs/nest-profiler-routes`).

`GraphQLCollectorModule` now registers a `ProfilerRouteSource` that reads the built schema from `@nestjs/graphql`'s public `GraphQLSchemaHost` and lists every query, mutation and subscription field with its argument names. It uses the schema (not private resolver metadata), so it works for both code-first and schema-first setups, and appears automatically when the Routes panel package is installed.
