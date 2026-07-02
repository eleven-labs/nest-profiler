# Collector detection matrix

Map a dependency found in the consumer's `package.json` to the collector package that instruments it. All collectors are published under the `@eleven-labs/` scope, peer on the core `@eleven-labs/nest-profiler`, `@nestjs/common@^11`, `@nestjs/core@^11`, `reflect-metadata@^0.2`, and (except `config`) `nestjs-cls@^6`. Only the **distinguishing** signal is listed below.

Detection confidence:

- **Hard peer** — the collector declares the host lib as a required peer; presence in the consumer is a reliable signal.
- **Optional peer** — declared via `peerDependenciesMeta`; the module is a safe no-op when the host lib is absent, so it is fine to offer but never force.
- **Heuristic** — no host peer at all; key off a related package the app is likely to use.

## Matrix

| Consumer dependency (signal)                | Confidence                                     | Collector package                      | `forRoot` snippet                                                                                                                      | Placement                                                             |
| ------------------------------------------- | ---------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `typeorm` + `@nestjs/typeorm`               | hard                                           | `@eleven-labs/nest-profiler-typeorm`   | `TypeOrmCollectorModule.forRootAsync({ inject: [DataSource], useFactory: (dataSource) => ({ dataSource, slowQueryThreshold: 100 }) })` | root, **after** `TypeOrmModule`                                       |
| `@mikro-orm/core` + `@mikro-orm/nestjs`     | hard                                           | `@eleven-labs/nest-profiler-mikro-orm` | `MikroOrmCollectorModule.forRoot({ slowQueryThreshold: 100 })`                                                                         | root, **after** `MikroOrmModule` (ESM-only)                           |
| `mongoose` + `@nestjs/mongoose`             | hard                                           | `@eleven-labs/nest-profiler-mongoose`  | `MongooseCollectorModule.forRoot({ slowQueryThreshold: 100 })`                                                                         | root or feature; needs `MongooseModule.forRoot`                       |
| `@nestjs/cache-manager`                     | hard                                           | `@eleven-labs/nest-profiler-cache`     | `CacheCollectorModule.forRoot()`                                                                                                       | root, **after** `CacheModule`                                         |
| `@nestjs/config`                            | hard                                           | `@eleven-labs/nest-profiler-config`    | `ConfigCollectorModule.forRoot({ maskKeys: ['database.password'] })`                                                                   | root (global), **after** `ConfigModule`                               |
| `@nestjs/graphql` + `graphql`               | hard (`graphql`), optional (`@nestjs/graphql`) | `@eleven-labs/nest-profiler-graphql`   | `ProfilerGraphQLModule.forRoot()`                                                                                                      | root, alongside `GraphQLModule` — **context must expose the request** |
| `@nestjs/axios` / `axios` (any HTTP client) | optional                                       | `@eleven-labs/nest-profiler-http`      | `HttpCollectorModule.forRoot()`                                                                                                        | root, with `HttpModule` imported in the same module                   |
| `nest-commander`                            | optional                                       | `@eleven-labs/nest-profiler-commander` | `CommanderCollectorModule.forRoot()`                                                                                                   | CLI root module **and** imported in the HTTP app; needs file storage  |
| `@golevelup/nestjs-rabbitmq` + `amqplib`    | optional                                       | `@eleven-labs/nest-profiler-rabbitmq`  | `RabbitMqCollectorModule.forRoot()`                                                                                                    | root of the process that consumes messages                            |
| `@nestjs/passport` / `@nestjs/jwt`          | heuristic (dependency-free)                    | `@eleven-labs/nest-profiler-auth`      | `AuthCollectorModule.forRoot({ maskUserFields: ['password', 'refreshToken'] })`                                                        | auth/app module                                                       |
| `class-validator` / `nestjs-zod`            | heuristic (deliberately not a peer)            | `@eleven-labs/nest-profiler-validator` | `ValidatorCollectorModule.forRoot({ validationPipeOptions: { whitelist: true, transform: true } })`                                    | root (installs global `APP_PIPE`)                                     |

Every collector is gated the same way as the core module — wrap the `forRoot(...)` in `ConditionalModule.registerWhen(..., isProfilerEnabled)` (Approach A) or rely on the core `enabled` flag (Approach B). Collectors need **no** no-op counterpart: they self-register through discovery and simply do nothing when the active profiler is absent.

## Placement rule

- **Root / global collectors** — `config` and `validator` install global providers (`APP_PIPE`, bootstrap snapshot), so they belong at the composition root. Bundling them with the core module into a single `ProfilingModule` (see `enable-strategies.md`) keeps the root tidy.
- **Infra-scoped collectors** — database (typeorm/mikro-orm/mongoose), `http`, `cache`, `rabbitmq`, and the GraphQL transport stay co-located in the feature module that owns their infrastructure, each with its own gate.

## Per-collector gotchas

- **typeorm** — the `DataSource` is not available at declaration time; use `forRootAsync` with `inject: [DataSource]`. Option `slowQueryThreshold` (ms, default 100).
- **mikro-orm** — the only ESM-only collector (`"type": "module"`). Import it **after** `MikroOrmModule`; it wraps the ORM logger on init. No `dataSource` needed.
- **mongoose** — patches `Query`/`Aggregate` `exec`; `MongooseModule.forRoot` must be registered first.
- **http** — "bring your own client". The bundled axios adapter is on by default but a **no-op unless `HttpModule` (`@nestjs/axios`) is imported in the same module**. For fetch/undici/got, inject `HttpProfilerRecorder` and call `.capture({...})`, or implement `HttpInstrumentation` and pass it via `instrumentations`. Body/header capture options: `captureRequestBody` (true), `captureResponseBody` (false), `maskHeaders` ([]).
- **cache** — wraps `CACHE_MANAGER` get/set/del via a Proxy; register **after** `CacheModule`. No options.
- **config** — snapshots config at bootstrap via `configService.internalConfig`; auto-masks `password|secret|key|token|credential|api_key`. Extra keys via `maskKeys`. Note: this is the one collector that does **not** peer on `nestjs-cls`.
- **graphql** — the `GraphQLModule.forRoot` **`context` must expose the request** so the profiler can bridge the async boundary. Per driver: Apollo `context: ({ req }) => ({ req })`, Mercurius `context: ({ request }) => ({ request })`, graphql-yoga `context: ({ req }) => ({ req })`. Also exports `ignoreGraphQLPlayground` / `ignoreGraphQLIntrospection` to compose with the core `ignoreRequest` via `combineFilters(...)`.
- **validator** — registers a global `ProfilerValidationPipe` (`APP_PIPE`) that wraps your pipe. **Do not register a second global `ValidationPipe`.** Use **value** imports (not `import type`) for DTOs so `reflect-metadata` emits the metatype. class-validator is the default (`pipe` omitted); for zod pass `{ pipe: new ZodValidationPipe() }`.
- **commander** — CLI and HTTP server are separate processes, so in-memory storage cannot share profiles. Set `storageType: 'file'` on the core module, register the collector in the module you bootstrap with `CommandFactory.run(...)`, **and** import it in the HTTP app so command profiles render there.
- **rabbitmq** — registers a context adapter for the `rmq` context that opens a fresh profile per consumed message. Options `captureHeaders` (true), `captureBody` (true), `maskHeaders`.
- **auth** — dependency-free; reads `request.user` and the `Authorization` header from CLS and decodes the JWT without verifying it. Built-in mask covers `password|secret|key|token|credential`; add fields via `maskUserFields`.
