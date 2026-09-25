# Remaining collectors — Cache · GraphQL · Commander · Routes · RabbitMQ

Mostly `enabled`-only collectors: for these the main decision is simply **whether to include them**. RabbitMQ is the one exception with capture options. All are registered in the `ProfilingModule` bundle (see `collectors-matrix.md`).

---

## Cache — `@eleven-labs/nest-profiler-cache`

- **Peers (required):** `@nestjs/cache-manager@^3`, `nestjs-cls@^6`.
- **Module:** `CacheCollectorModule.forRoot()` — **`forRoot` only**, option `enabled` only.
- **Placement:** the `ProfilingModule` bundle.
- **Behaviour:** wraps `CACHE_MANAGER` get/set/del via a Proxy.
- **⚠️ Gotcha:** it injects `CACHE_MANAGER`, so the app must register `CacheModule.register({ isGlobal: true })` — a non-global cache manager is invisible from the bundle and nothing is captured.
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-cache> · tutorial: <https://nest-profiler.eleven-labs.com/docs/tutorials/cache-collector>

```ts
// in ProfilingModule's imports:
CacheCollectorModule.forRoot(),
```

---

## GraphQL — `@eleven-labs/nest-profiler-graphql`

- **Peers:** `graphql@^16`, `nestjs-cls@^6`, `rxjs@^7` (required); `@nestjs/graphql@^13` **optional**.
- **Module:** `GraphQLCollectorModule.forRoot()` — **`forRoot` only**, option `enabled` only. (Note: the module is `GraphQLCollectorModule`.)
- **Placement:** the `ProfilingModule` bundle. The app's `GraphQLModule` keeps its `context` (plain app config, no profiler import).
- **⚠️ Gotcha — the `GraphQLModule.forRoot` `context` must expose the request** so the profiler can bridge the async boundary:
  - Apollo: `context: ({ req }) => ({ req })`
  - Mercurius: `context: ({ request }) => ({ request })`
  - graphql-yoga: `context: ({ req }) => ({ req })`
- Also exports `ignoreGraphQLPlayground` / `ignoreGraphQLIntrospection` to compose with the core `ignoreRequest` via `combineFilters(...)`, so playground/introspection noise is skipped.
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-graphql> · tutorial: <https://nest-profiler.eleven-labs.com/docs/tutorials/graphql-collector>

```ts
import { GraphQLCollectorModule } from '@eleven-labs/nest-profiler-graphql';

// in ProfilingModule's imports:
GraphQLCollectorModule.forRoot(),

// in the app's own module:
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
- **⚠️ Gotcha:** the CLI and the HTTP server are separate processes, so in-memory storage cannot share profiles. Use a cross-process store on the core — `storageType: 'file'`, or the SQLite `storage` adapter (there is no `storageType: 'sqlite'`) — register the collector in the CLI bundle bootstrapped by `cli-dev.ts` (`CommandFactory.run(CliDevModule, ...)`, see `enable-strategies.md`), **and** in the web bundle so command profiles render at `/_profiler`.
- **⚠️ Gotcha (`ConditionalModule` install only):** the CLI root module must import `ConfigModule.forRoot()` from `@nestjs/config`. A `ConditionalModule.registerWhen` gate `await`s `ConfigModule.envVariablesLoaded`, which only resolves once `ConfigModule.forRoot()` has run — a `CommandFactory` CLI that omits it hangs and exits `0` **silently** (the internal timeout is `unref`'d).
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-commander> · tutorial: <https://nest-profiler.eleven-labs.com/docs/tutorials/commander-collector>

```ts
// in the web and CLI bundles' imports:
CommanderCollectorModule.forRoot(),
```

---

## Discover — `@eleven-labs/nest-profiler-routes`

- **Peers:** `class-validator@>=0.14 <1` **optional**. No `nestjs-cls`.
- **Module:** `RoutesCollectorModule` (`forRoot` + `forRootAsync`), option `enabled` only.
- **Placement:** the `ProfilingModule` bundle (opt-in global panels).
- **Behaviour:** adds one global **Discover** view per transport, listing the REST, GraphQL, RabbitMQ and CLI entrypoints discovered in the app.
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-routes>

```ts
// in ProfilingModule's imports:
RoutesCollectorModule.forRoot(),
```

---

## RabbitMQ — `@eleven-labs/nest-profiler-rabbitmq`

- **Peers:** `@golevelup/nestjs-rabbitmq@^9` **optional**, `amqplib@^0.10` **optional**. No `nestjs-cls`.
- **Module:** `RabbitMqCollectorModule` (`forRoot` + `forRootAsync`).
- **Placement:** the bundle of the process that **consumes** messages; the app keeps `RabbitMQModule` in its own module. Add `RabbitMqPublishCollectorModule.forRoot()` to list published messages in the emitting profile.
- **Behaviour:** registers a context adapter for the `rmq` context and opens a fresh profile per consumed message (a `rabbitmq` entrypoint).
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-rabbitmq> · tutorial: <https://nest-profiler.eleven-labs.com/docs/tutorials/rabbitmq-collector>

| Option           | Type       | Default   | Notes                                                               |
| ---------------- | ---------- | --------- | ------------------------------------------------------------------- |
| `enabled`        | `boolean`  | `true`    | Synchronous.                                                        |
| `captureHeaders` | `boolean`  | `true`    | —                                                                   |
| `captureBody`    | `boolean`  | `true`    | —                                                                   |
| `maskHeaders`    | `string[]` | built-ins | merged with `authorization`, `cookie`, `x-api-key`, `x-auth-token`. |

```ts
// in ProfilingModule's imports:
RabbitMqCollectorModule.forRoot(),
RabbitMqPublishCollectorModule.forRoot(),
```

---

## Event emitter — `@eleven-labs/nest-profiler-event-emitter`

- **Peers (required):** `@nestjs/event-emitter@^3`, `nestjs-cls@^6`.
- **Module:** `EventEmitterCollectorModule` (`forRoot` + `forRootAsync`).
- **Placement:** the `ProfilingModule` bundle; the app keeps `EventEmitterModule.forRoot()` in its own module.
- **Behaviour:** patches `EventEmitter2`'s `emit`/`emitAsync` for an **Events** panel on the emitting profile, contributes a **Discover / Events** view listing every `@OnEvent` subscription, and — unless `profileListeners: false` — turns each `@OnEvent` execution into its own `event` profile (list view + **Event** detail tab) carrying the handler's own logs, queries and HTTP calls.
- **⚠️ Gotcha:** **request-scoped** subscribers are not profiled — `@nestjs/event-emitter` resolves a fresh instance per event, so there is no stable handler to wrap. They still appear in the Routes panel.
- **⚠️ Gotcha:** `EventEntry.error` is rarely populated: `@OnEvent` defaults to `suppressErrors: true`, so a throwing handler is logged by `@nestjs/event-emitter` and never surfaces to the emitter. The handler's own `event` profile records the failure either way.
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-event-emitter> · tutorial: <https://nest-profiler.eleven-labs.com/docs/tutorials/event-emitter-collector>

| Option              | Type                      | Default         | Notes                                                     |
| ------------------- | ------------------------- | --------------- | --------------------------------------------------------- |
| `enabled`           | `boolean`                 | `true`          | Synchronous.                                              |
| `capturePayload`    | `boolean`                 | `true`          | Redacted; turn off when payloads may hold PII.            |
| `maxPayloadLength`  | `number`                  | `2000`          | Bounds the stringified payload per event.                 |
| `ignoreEvents`      | `Array<string \| RegExp>` | `[]`            | `newListener`/`removeListener` are always ignored on top. |
| `emitterToken`      | `InjectionToken`          | `EventEmitter2` | Only when the emitter is bound to a custom token.         |
| `profileListeners`  | `boolean`                 | `true`          | `false` keeps the per-request Events panel only.          |
| `slowThreshold`     | `number`                  | `100`           | ms; tags an emission `slow` (own `event` tag domain).     |
| `nPlusOneThreshold` | `number`                  | `2`             | Identical event names before the `n-plus-one` tag.        |
| `chattyThreshold`   | `number`                  | `20`            | Emissions before the profile is tagged `chatty`.          |
| `error`             | `ProfilerErrorOptions`    | —               | What counts as a failed handler execution.                |

```ts
// in ProfilingModule's imports:
EventEmitterCollectorModule.forRoot(),
```
