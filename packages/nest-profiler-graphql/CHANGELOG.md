# @eleven-labs/nest-profiler-graphql

## 1.0.0

### Major Changes

- 3a507ec: First stable release. `@eleven-labs/nest-profiler-graphql` brings GraphQL into the profiler: queries and mutations get their own sidebar view and a dedicated **GraphQL** detail tab.

  - `GraphQLCollectorModule` (`forRoot()` / `forRootAsync()`) records the operation type and name, the syntax-highlighted query, the variables and the response, and files each operation under the `graphql` entrypoint kind rather than a generic HTTP request.
  - Field resolvers are collected onto the operation's trace, so a resolver waterfall is visible alongside the queries it triggered.
  - A GraphQL response is `200` even when the operation failed, so the error definition keys on `extensions.code` instead of the status: only `INTERNAL_SERVER_ERROR` and errors carrying no code count by default, and the `error` option redefines that.
  - `GraphqlDiscoverSource` contributes the **Discover / GraphQL** view, listing every field with its arguments.

  Compatible with Apollo, Mercurius and graphql-yoga. Requires Node >= 22, NestJS 11 and `@eleven-labs/nest-profiler` ^1.0.0, with `@nestjs/graphql` ^13 and `graphql` ^16 as peers.

  Documentation: https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-graphql
