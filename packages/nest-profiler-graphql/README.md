# @eleven-labs/nest-profiler-graphql

<p align="center">
  <a href="https://eleven-labs.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/assets/eleven-labs-white.svg">
      <img alt="Powered &amp; maintained by Eleven Labs" src="https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/assets/eleven-labs-dark.svg" width="180">
    </picture>
  </a>
</p>

<p align="center"><em>Powered &amp; maintained by <a href="https://eleven-labs.com">Eleven Labs</a></em></p>

<p align="center">
  <a href="https://github.com/eleven-labs/nest-profiler/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/eleven-labs/nest-profiler/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/eleven-labs/nest-profiler/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/eleven-labs/nest-profiler/actions/workflows/quality.yml/badge.svg" /></a>
  <a href="https://codecov.io/gh/eleven-labs/nest-profiler/flags"><img alt="Coverage" src="https://codecov.io/gh/eleven-labs/nest-profiler/branch/main/graph/badge.svg?flag=nest-profiler-graphql" /></a>
  <a href="https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-graphql"><img alt="Documentation" src="https://img.shields.io/badge/docs-nest--profiler.eleven--labs.com-e5225a" /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a" />
  <img alt="Built with NestJS" src="https://img.shields.io/badge/built%20with-NestJS-ea2845" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Code style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" />
</p>

`@eleven-labs/nest-profiler-graphql` captures GraphQL queries and mutations and displays them in their own **GraphQL** sidebar view, each with a dedicated **GraphQL** detail tab (operation, query, variables and response).

![GraphQL view showing GQL MUTATION and GQL QUERY badges alongside the operation name and status](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/graphql-list.png)

![GraphQL detail tab showing operation type, operation name, syntax-highlighted query and variables](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/graphql-request.png)

## Installation

```bash
pnpm add @eleven-labs/nest-profiler-graphql
```

## Setup

Import `GraphQLCollectorModule` alongside `ProfilerModule` in your application module.

### Apollo Server (Express or Fastify)

```ts
import { ConditionalModule } from '@nestjs/config';
import { GraphQLCollectorModule } from '@eleven-labs/nest-profiler-graphql';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] === 'true';

@Module({
  imports: [
    ConditionalModule.registerWhen(GraphQLCollectorModule.forRoot(), isProfilerEnabled),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      // Required — exposes the Express/Fastify request so the profiler can
      // store and recover the profile across the async context boundary.
      context: ({ req }) => ({ req }),
    }),
  ],
})
export class AppModule {}
```

### Mercurius (Fastify)

```ts
(GraphQLCollectorModule.forRoot(),
  GraphQLModule.forRoot<MercuriusDriverConfig>({
    driver: MercuriusDriver,
    autoSchemaFile: true,
    // Mercurius uses `request` instead of `req`
    context: ({ request }) => ({ request }),
  }));
```

### graphql-yoga (Express or Fastify)

```ts
(GraphQLCollectorModule.forRoot(),
  GraphQLModule.forRoot<YogaDriverConfig>({
    driver: YogaDriver,
    autoSchemaFile: true,
    context: ({ req }) => ({ req }),
  }));
```

## Enabling and disabling

> **Enabling / disabling** — gate the collector with `ConditionalModule.registerWhen(..., isProfilerEnabled)` as shown, so it loads only when `PROFILER_ENABLED` is on. Wire the core `ProfilerModule` and its `ProfilerNoopModule` fallback **once at the root** — the recommended setup bundles the root-level profiler modules into a single `ProfilingModule` behind two `ConditionalModule` gates (see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#enabling-and-disabling-the-profiler) and the [example app](https://nest-profiler.eleven-labs.com/docs/example-api)). A top-level `enabled` option is also supported as an alternative.

## Ignoring playground and introspection requests

The playground and introspection requests are profiled by default. Use the
`ignoreRequest` option of `ProfilerModule` together with the pre-built filters
from this package to exclude them:

```ts
import { ProfilerModule, combineFilters } from '@eleven-labs/nest-profiler';
import {
  GraphQLCollectorModule,
  ignoreGraphQLPlayground,
  ignoreGraphQLIntrospection,
} from '@eleven-labs/nest-profiler-graphql';

ProfilerModule.forRoot({
  isGlobal: true,
  ignoreRequest: combineFilters(ignoreGraphQLPlayground, ignoreGraphQLIntrospection),
}),
GraphQLCollectorModule.forRoot(),
```

| Filter                       | Skips                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `ignoreGraphQLPlayground`    | `GET /graphql` with `Accept: text/html` — the Sandbox UI page load                             |
| `ignoreGraphQLIntrospection` | Any POST with `operationName: IntrospectionQuery` or a query referencing `__schema` / `__type` |

## What is captured

Each profiled GraphQL request shows a **GQL** badge in `/_profiler` and records:

| Field           | Description                                    |
| --------------- | ---------------------------------------------- |
| `operationType` | `query`, `mutation`, or `subscription`         |
| `operationName` | Named operation (e.g. `GetBooks`), if provided |
| `fieldName`     | Entry-point resolver field                     |
| `query`         | The full GraphQL document (formatted)          |
| `variables`     | Variables object                               |

Registering this module installs the `graphql` entrypoint type: GraphQL operations get their own **GraphQL** view on `/_profiler`, with a filter bar including an **Operation** filter (query / mutation / subscription).

GraphQL-level errors (schema validation failures, resolver errors) appear in the **Exceptions** tab with an amber `GraphQLError` badge, distinct from NestJS runtime exceptions. Since GraphQL names every error `GraphQLError`, its `extensions.code` is shown alongside — that code is what the **Exception** filter lists and what decides whether the operation counts as an error.

![Exceptions tab showing an amber GraphQLError badge with its BAD_REQUEST code, validation message and location](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/graphql-error.png)

## Options

`GraphQLCollectorModule.forRoot(options)` accepts:

| Option    | Default                 | Description                                                                                                                                             |
| --------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled` | `true`                  | Enable GraphQL profiling.                                                                                                                               |
| `error`   | `INTERNAL_SERVER_ERROR` | What counts as a **failed operation**. A GraphQL response is `200` even when it failed, so statuses say nothing and `extensions.code` takes their role. |

A `BAD_REQUEST` (what the Nest Apollo driver emits for a rejected mutation), `BAD_USER_INPUT`, `UNAUTHENTICATED` or `NOT_FOUND` is the schema answering correctly — GraphQL's equivalent of a 4xx — so none of them is an error by default. An error carrying no code counts, as an unmapped throw is a genuine failure.

```ts
// Here, a failed login is an incident worth surfacing.
GraphQLCollectorModule.forRoot({
  error: { codes: ['INTERNAL_SERVER_ERROR', 'UNAUTHENTICATED'] },
});
```

Use `forRootAsync` to resolve the options from `ConfigService`. See [What counts as an error](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/error-classification).

## How it works

`GraphQLCollectorModule` registers `GraphQLContextAdapter` with `ProfilerCoreService` on module init. The adapter supports all NestJS GraphQL drivers that expose the HTTP request in the execution context:

- **Apollo** (Express / Fastify): looks for `gqlCtx.req`
- **Mercurius** (Fastify): looks for `gqlCtx.request`

A middleware `finish` hook also captures GraphQL errors for requests that Apollo handles without calling any resolver (e.g. schema validation failures), ensuring those profiles still appear in `/_profiler`.

## Custom protocol adapters

This package is the reference implementation of the `IContextAdapter` pattern from `@eleven-labs/nest-profiler`. You can use the same pattern to profile gRPC, Kafka, WebSockets, or any other NestJS execution context — see the [`@eleven-labs/nest-profiler` documentation](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/context-adapters) for a full example.

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
