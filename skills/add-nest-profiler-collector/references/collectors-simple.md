# Remaining collectors — Cache · GraphQL · Commander · Routes · RabbitMQ

Mostly `enabled`-only collectors: for these the main decision is simply **whether to include them**. RabbitMQ is the one exception with capture options. All are gated the same way as the core.

---

## Cache — `@eleven-labs/nest-profiler-cache`

- **Peers (required):** `@nestjs/cache-manager@^3`, `nestjs-cls@^6`.
- **Module:** `CacheCollectorModule.forRoot()` — **`forRoot` only**, option `enabled` only.
- **Placement:** the module that imports `CacheModule`, **after** it.
- **Behaviour:** wraps `CACHE_MANAGER` get/set/del via a Proxy.
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-cache> · tutorial: <https://nest-profiler.eleven-labs.com/docs/tutorials/cache-collector>

```ts
ConditionalModule.registerWhen(CacheCollectorModule.forRoot(), isProfilerEnabled),
```

---

## GraphQL — `@eleven-labs/nest-profiler-graphql`

- **Peers:** `graphql@^16`, `nestjs-cls@^6`, `rxjs@^7` (required); `@nestjs/graphql@^13` **optional**.
- **Module:** `GraphQLCollectorModule.forRoot()` — **`forRoot` only**, option `enabled` only. (Note: the module is `GraphQLCollectorModule`.)
- **Placement:** the module that sets up `GraphQLModule`, alongside it.
- **⚠️ Gotcha — the `GraphQLModule.forRoot` `context` must expose the request** so the profiler can bridge the async boundary:
  - Apollo: `context: ({ req }) => ({ req })`
  - Mercurius: `context: ({ request }) => ({ request })`
  - graphql-yoga: `context: ({ req }) => ({ req })`
- Also exports `ignoreGraphQLPlayground` / `ignoreGraphQLIntrospection` to compose with the core `ignoreRequest` via `combineFilters(...)`, so playground/introspection noise is skipped.
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-graphql> · tutorial: <https://nest-profiler.eleven-labs.com/docs/tutorials/graphql-collector>

```ts
import { GraphQLCollectorModule } from '@eleven-labs/nest-profiler-graphql';

ConditionalModule.registerWhen(GraphQLCollectorModule.forRoot(), isProfilerEnabled),
GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  autoSchemaFile: true,
  context: ({ req }) => ({ req }), // required by the profiler
}),
```

---

## Commander — `@eleven-labs/nest-profiler-commander`

- **Peers (required):** `nest-commander@^3.20`, `nestjs-cls@^6`.
- **Module:** `CommanderCollectorModule.forRoot()` — **`forRoot` only**, option `enabled` only.
- **⚠️ Gotcha:** the CLI and the HTTP server are separate processes, so in-memory storage cannot share profiles. Use a cross-process store on the core — `storageType: 'file'`, or the SQLite `storage` adapter (there is no `storageType: 'sqlite'`) — register the collector in the module you bootstrap with `CommandFactory.run(...)`, **and** import it in the HTTP app so command profiles render at `/_profiler`.
- **⚠️ Gotcha:** the CLI root module must import `ConfigModule.forRoot()` from `@nestjs/config`. The `ConditionalModule.registerWhen` gate below `await`s `ConfigModule.envVariablesLoaded`, which only resolves once `ConfigModule.forRoot()` has run — a `CommandFactory` CLI that omits it hangs and exits `0` **silently** (the internal timeout is `unref`'d).
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-commander> · tutorial: <https://nest-profiler.eleven-labs.com/docs/tutorials/commander-collector>

```ts
ConditionalModule.registerWhen(CommanderCollectorModule.forRoot(), isProfilerEnabled),
```

---

## Routes — `@eleven-labs/nest-profiler-routes`

- **Peers:** `class-validator@>=0.14 <1` **optional**. No `nestjs-cls`.
- **Module:** `RoutesCollectorModule` (`forRoot` + `forRootAsync`), option `enabled` only.
- **Placement:** the composition root (opt-in global panel). Bundle into `ProfilingModule`.
- **Behaviour:** adds a global **Routes** panel listing REST, GraphQL, RabbitMQ and CLI entrypoints discovered in the app.
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-routes>

```ts
ConditionalModule.registerWhen(RoutesCollectorModule.forRoot(), isProfilerEnabled),
```

---

## RabbitMQ — `@eleven-labs/nest-profiler-rabbitmq`

- **Peers:** `@golevelup/nestjs-rabbitmq@^9` **optional**, `amqplib@^0.10` **optional**. No `nestjs-cls`.
- **Module:** `RabbitMqCollectorModule` (`forRoot` + `forRootAsync`).
- **Placement:** the module of the process that **consumes** messages, alongside `RabbitMQModule`.
- **Behaviour:** registers a context adapter for the `rmq` context and opens a fresh profile per consumed message (a `rabbitmq` entrypoint).
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-rabbitmq> · tutorial: <https://nest-profiler.eleven-labs.com/docs/tutorials/rabbitmq-collector>

| Option           | Type       | Default   | Notes                                                               |
| ---------------- | ---------- | --------- | ------------------------------------------------------------------- |
| `enabled`        | `boolean`  | `true`    | Synchronous.                                                        |
| `captureHeaders` | `boolean`  | `true`    | —                                                                   |
| `captureBody`    | `boolean`  | `true`    | —                                                                   |
| `maskHeaders`    | `string[]` | built-ins | merged with `authorization`, `cookie`, `x-api-key`, `x-auth-token`. |

```ts
ConditionalModule.registerWhen(RabbitMqCollectorModule.forRoot(), isProfilerEnabled),
```
