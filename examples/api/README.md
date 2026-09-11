# example-api

`examples/api` is a feature-complete NestJS application demonstrating every built-in `nest-profiler` collector. It is organised as a small **marketplace backend** split into bounded contexts, each following **clean architecture / DDD** (domain / application / http / infrastructure) — the same shape across the whole app, not just one module.

The composition root (`app.module.ts`) holds **no controller and no feature logic** — only cross-cutting `forRoot`/global registrations and imports of the feature modules. Every context exposes its persistence/transport tech behind a **port** (an `abstract class` used as the DI token), so an adapter can be swapped by one environment variable without touching the domain, application or transport layers.

## Live demo

A live instance is deployed on Vercel with a hosted Postgres for the catalog and none of the opt-in infrastructure:

```
SQL_ORM=mikro-orm       # catalog on the hosted Postgres (DATABASE_* / POSTGRES_* / PG*)
FEATURE_MONGOOSE=false  # reviews / MongoDB disabled
FEATURE_RABBITMQ=false  # no broker
FEATURE_GRAPHQL=true    # GraphQL served over the catalog
```

Active collectors on the live demo: **Catalog** (SQL, REST + **GraphQL**), **Content** (HTTP + Cache), **Auth**, **Config**, **Validator**.

On a serverless host the app does not own the port: when `VERCEL` is set, `main.ts` initialises Nest and exports the Express request handler instead of calling `listen()`. The platform imports the entrypoint and only watches for a `listen()` call for about a second before giving up, which a bootstrap of this size never meets.

| Endpoint                 | URL                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Swagger UI               | [nest-profiler-example.eleven-labs.com/api](https://nest-profiler-example.eleven-labs.com/api)              |
| Apollo Sandbox (GraphQL) | [nest-profiler-example.eleven-labs.com/graphql](https://nest-profiler-example.eleven-labs.com/graphql)      |
| Profiler UI              | [nest-profiler-example.eleven-labs.com/\_profiler](https://nest-profiler-example.eleven-labs.com/_profiler) |

## Getting started

### Prerequisites

- Node.js 22+, pnpm 10+
- Docker — PostgreSQL backs the catalog, so it is required; MongoDB and RabbitMQ are only needed when `FEATURE_MONGOOSE`/`FEATURE_RABBITMQ` are on

### Start the infrastructure

A `docker-compose.yml` is provided at the **project root**:

```bash
docker compose up -d
```

This starts **PostgreSQL 16** (`5432`) for the SQL ORM collectors, **MongoDB 7** (`27017`) for the Mongoose collector, and **RabbitMQ** (`5672`) for the messaging collector.

### Feature flags

The app uses flags to conditionally load infrastructure-dependent contexts. Everything beyond the catalog's PostgreSQL is **off by default**, so a bare run needs no MongoDB and no broker. Set them in `.env`:

| Variable                      | Default     | Description                                                                                                                                                                                        |
| ----------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SQL_ORM`                     | `mikro-orm` | Catalog persistence adapter: `mikro-orm` \| `typeorm` (both need PostgreSQL)                                                                                                                       |
| `HTTP_CLIENT`                 | `axios`     | Content HTTP client / profiler adapter: `axios` \| `fetch`                                                                                                                                         |
| `FEATURE_MONGOOSE`            | `false`     | Load the Mongoose-backed `ReviewsModule` (needs MongoDB)                                                                                                                                           |
| `FEATURE_GRAPHQL`             | `true`      | Expose the catalog over GraphQL (served over either catalog adapter)                                                                                                                               |
| `FEATURE_RABBITMQ`            | `false`     | Publish `review.created` to RabbitMQ + run the consumer, both profiled (`nest-profiler-rabbitmq`)                                                                                                  |
| `FEATURE_DATALOADER`          | `false`     | Batch the GraphQL `Product.reviews` + `Review.author` lookups with DataLoader: one MongoDB query and one HTTP call instead of N                                                                    |
| `FEATURE_PINO_LOGGER`         | `true`      | Use the third-party `nestjs-pino` logger; `false` falls back to `ConsoleLogger`                                                                                                                    |
| `PROFILER_ENABLED`            | `true`      | Enable the profiler UI and all collectors                                                                                                                                                          |
| `PROFILER_STORAGE_TYPE`       | `file`      | Profiler storage backend: `memory` \| `file` \| `sqlite`                                                                                                                                           |
| `PROFILER_AUTH`               | `none`      | Access control for `/_profiler`: `none` \| `basic` \| `token` \| `cookie`                                                                                                                          |
| `PROFILER_INSTRUMENT`         | `true`      | Automatic instrumentation: one span per provider method call, so the Execution Trace shows the full call tree. On here because this app is a demo; **opt-in and development-only** in your own app |
| `PROFILER_INSTRUMENT_EXCLUDE` | —           | Classes and methods to keep off the instrumented trace, comma-separated: `ConfigService` (the class), `ClockService.now` (one method), `*.getRequestId` (a wildcard within a name)                 |

`PROFILER_AUTH` selects how the demo protects the `/_profiler` dashboard — the consumer-side counterpart of the profiler's pluggable [`security`](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#securing-the-ui) option, chosen by env exactly like `SQL_ORM`. `none` (default) leaves it open; `basic` uses HTTP Basic auth (`PROFILER_BASIC_USER` / `PROFILER_BASIC_PASSWORD`); `token` checks a bearer or `?token=<PROFILER_TOKEN>` credential (the query is threaded across UI links via `linkQuery`); and `cookie` reuses the app's own `JwtAuthGuard` through `security.guards` — the guard reads the JWT from the `profiler_jwt` cookie that `GET /api/v1/auth/token` sets, so the browser sends it on every link and the whole UI is navigable (a `Bearer` header is still accepted for `curl`). Because navigation happens through plain links, prefer `basic`, `cookie` or a session for browser access (the browser propagates those automatically); a pure `token` header suits `curl`.

`PROFILER_STORAGE_TYPE=sqlite` uses the built-in libSQL-backed `SqliteStorageAdapter`. It targets a local file by default (`PROFILER_STORAGE_PATH`); set `PROFILER_STORAGE_URL` (+ `PROFILER_STORAGE_AUTH_TOKEN`) to point the same adapter at a remote SQLite database such as Turso Cloud — required on serverless hosts like Vercel, where the filesystem is read-only. On Vercel these fall back to the Turso integration's `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`.

`SQL_ORM` selects which adapter backs the **catalog** context: `mikro-orm` (the default) or `typeorm`. They are mutually exclusive — both map the same Postgres `products` table — so the catalog always needs a database. The other contexts stay behind their own flags: the ones whose infrastructure is off are simply not registered, so no connection is attempted and nothing crashes.

PostgreSQL can be configured with the app-specific `DATABASE_HOST` / `DATABASE_PORT` / `DATABASE_USER` / `DATABASE_PASSWORD` / `DATABASE_NAME` variables. Hosted Vercel Neon integrations also work without aliases: the app falls back to `POSTGRES_*` and `PG*` variables, and enables SSL when `DATABASE_SSL=true` or `PGSSLMODE=require`. The demo ships no migrations, so the ORM creates the `products` table automatically on boot; the destructive drop-and-recreate only runs outside production, so a deployed database keeps its structure across cold starts.

`HTTP_CLIENT` selects which adapter backs the outgoing HTTP ports — the **content** context's `ArticleGateway` and the **reviews** context's `ReviewerGateway` — `axios` (via `@nestjs/axios`, the default) or native `fetch`. The two are interchangeable and profiled the same way; switching only changes which HTTP Client instrumentation captures the calls (`AxiosInstrumentation` vs `FetchInstrumentation`). Same pattern as `SQL_ORM`, applied to the outgoing HTTP client.

```bash
# Everything on (needs docker compose up -d)
SQL_ORM=typeorm FEATURE_MONGOOSE=true FEATURE_RABBITMQ=true pnpm example:dev

# Profile SQL queries through MikroORM instead of TypeORM
SQL_ORM=mikro-orm FEATURE_MONGOOSE=true pnpm example:dev

# Profile outgoing HTTP through native fetch instead of axios
HTTP_CLIENT=fetch pnpm example:dev

# Default set: Catalog (mikro-orm) + GraphQL, Content, Auth, Config, Validator — needs Postgres only
pnpm example:dev

# Without GraphQL
FEATURE_GRAPHQL=false pnpm example:dev
```

Domain events flow through the `EventPublisher` port, which has two live adapters. By default it is bound to the **in-process** `@nestjs/event-emitter` adapter: `POST /api/v1/products` publishes `product.created`, an `@OnEvent` listener reacts to it, and `nest-profiler-event-emitter` shows the emission in the request's **Events** panel plus the handler execution as its own `event` profile — no infrastructure needed. When `FEATURE_RABBITMQ=true`, the reviews context switches to the **RabbitMQ** adapter instead: `POST /api/v1/reviews` publishes `review.created` to the broker and a `@RabbitSubscribe` consumer reacts to it — profiled as a `rabbitmq` entrypoint with its own **Message** tab.

### Run the application

```bash
pnpm example:dev
```

The API starts on port `3000`. Copy `.env.example` to `.env` to customise connections.
Profiles are persisted to `.profiler/` (file storage) — they survive restarts.

### Profiling CLI commands (`nest-profiler-commander`)

A separate CLI entrypoint (`src/cli.ts` → `CliModule`) reuses the feature contexts that expose
commands and writes to the same `.profiler/` file storage as the HTTP app, so the runs show up at
`/_profiler` next to the HTTP profiles — the console equivalent of Symfony's command profiling.

```bash
pnpm --filter example-api build

# Fetches articles via the selected HTTP client and caches them — profile shows Command + HTTP Client + Cache panels.
# Reuses the same ArticleService as the REST controller (no duplicated fetch logic).
pnpm --filter example-api cli content:sync --limit 3

# A trivial command; add --fail to produce a failed profile (Exceptions tab)
pnpm --filter example-api cli demo:greet --name Fabien
```

Then start the HTTP app (`pnpm example:dev`) and open `/_profiler` to inspect the command profiles
(listed with a `CLI` badge). Commands are wrapped automatically — `SyncArticlesCommand` and
`GreetCommand` are ordinary `nest-commander` commands with no profiling code.

## Exploring the API

### Swagger UI

Open **[http://localhost:3000/api](http://localhost:3000/api)** for the interactive Swagger UI. Every endpoint is documented with its parameters, request body and expected responses.

#### Testing authenticated endpoints

`/api/v1/auth/me` requires a Bearer JWT. The built-in `/api/v1/auth/token` shortcut generates a demo token:

1. Call **`GET /api/v1/auth/token`** — pick a role (`user`, `admin`, `moderator`) and execute.
2. Copy the `token` value.
3. Click **Authorize** (top right), paste the token, confirm.
4. Call **`GET /api/v1/auth/me`** — the JWT is sent automatically.

> Authorization persists across reloads (`persistAuthorization: true`), so you set it once per session.

#### Swagger + profiler

Every request generates a full profile. After a call, copy the `X-Debug-Token` response header and open `/_profiler/{token}` to inspect the collected data.

### Apollo Sandbox

Open **[http://localhost:3000/graphql](http://localhost:3000/graphql)**. The schema is auto-generated from the catalog resolver, backed by whichever `SQL_ORM` adapter is active (mikro-orm by default):

```graphql
query GetProducts {
  products {
    id
    name
    price
    inStock
  }
}

query GetProduct($id: Int!) {
  product(id: $id) {
    id
    name
    price
  }
}

mutation CreateProduct($input: CreateProductInput!) {
  createProduct(input: $input) {
    id
    name
    price
  }
}
```

Each operation generates a profile with a **GQL** badge. The **Execution Trace** shows the `db.products.*` spans — declared once in `ProductService` and shared by the REST and GraphQL entrypoints.

#### One query, three sources

With `FEATURE_MONGOOSE=true`, the catalog query reaches beyond SQL. Each field resolver belongs to a different context and talks to a different backend:

```graphql
query Products {
  products {
    # 1. SQL catalog (root resolver, active SQL_ORM adapter)
    id
    name
    description
    inStock
    price
    createdAt
    reviews {
      # 2. MongoDB (ProductReviewsResolver, reviews context)
      id
      rating
      comment
      createdAt
      author {
        # 3. HTTP — external user directory (ReviewAuthorResolver)
        id
        name
        username
        company
      }
    }
  }
}
```

A review stores only its `authorId` (1-10, an id in the [jsonplaceholder](https://jsonplaceholder.typicode.com) user directory); the profile behind it is fetched over HTTP while the query resolves. One profile therefore shows the **Database**, **MongoDB** and **HTTP Client** panels filled by a single operation, and the waterfall interleaves their bars.

#### N+1 vs DataLoader (`FEATURE_DATALOADER`)

By default every field resolver reads on its own, and the query above is a textbook double N+1: one `find({ productId })` per product, then one `GET /users/:id` per review — with author #1 (who reviewed two products) fetched twice. The profiler tags the profile `N+1 ×5` and flags the repeated rows in the MongoDB and HTTP Client panels.

```bash
FEATURE_MONGOOSE=true FEATURE_DATALOADER=true pnpm example:dev
```

The same query then resolves through request-scoped DataLoaders, and the two batches chain: the reviews of every product in the result are read by a single `find({ productId: { $in: ["1", "2", "3", "4"] } })`, so all the reviews land in the same tick and every author lookup folds into a single `GET /users?id=1&id=2&id=3&id=4` — an id requested twice is fetched once. Four MongoDB queries and five HTTP calls become **one of each**, and the `n-plus-one` tag is gone. Run the query with the flag off, then on, and compare the two profiles side by side in `/_profiler` — same response, different waterfall.

|                                      | MongoDB                               | HTTP                  | Tag      |
| ------------------------------------ | ------------------------------------- | --------------------- | -------- |
| `FEATURE_DATALOADER=false` (default) | 4 × `find({ productId })`             | 5 × `GET /users/:id`  | `N+1 ×5` |
| `FEATURE_DATALOADER=true`            | 1 × `find({ productId: { $in: … } })` | 1 × `GET /users?id=…` | —        |

Both paths sit behind ports — `ProductReviewsLoader` and `ReviewerLoader`, each with a direct and a DataLoader adapter — selected by `ConditionalModule` exactly like every other adapter in this app; the resolvers themselves never change.

## Module architecture

Every context is layered (domain / application / http / infrastructure); the composition root only wires them:

```
AppModule (no controller — only global forRoot + feature modules)
├── CatalogModule            products aggregate, REST + GraphQL
│     ├── ProductMikroOrmModule  [SQL_ORM=mikro-orm, default] → MikroOrmCollectorModule (nest-profiler-mikro-orm)
│     ├── ProductTypeOrmModule   [SQL_ORM=typeorm]            → TypeOrmCollectorModule  (nest-profiler-typeorm)
│     └── CatalogGraphQLModule   [FEATURE_GRAPHQL]   → GraphQLCollectorModule  (nest-profiler-graphql) + Apollo
├── ContentModule            /api/v1/articles + content:sync CLI → CacheCollectorModule
│     ├── ArticleAxiosModule    [HTTP_CLIENT=axios, default] → HttpCollectorModule (AxiosInstrumentation) + @nestjs/axios
│     └── ArticleFetchModule    [HTTP_CLIENT=fetch]          → HttpCollectorModule (FetchInstrumentation)
├── AuthModule               → AuthCollectorModule (nest-profiler-auth)
├── HealthModule             → GET /health
├── DiagnosticsModule        → GET /api/v1/slow, /api/v1/crash + demo:greet CLI
├── CatalogModule → … also publishes product.created via the EventPublisher port:
│     └── NotificationsEventEmitterModule [always]           → EventEmitterCollectorModule + @OnEvent listener
└── ReviewsModule [FEATURE_MONGOOSE]
      ├── ReviewApplicationModule → ReviewService, shared by the REST and GraphQL entrypoints
      │     ├── ReviewMongooseModule → MongooseCollectorModule (nest-profiler-mongoose)
      │     └── publishes review.created via the EventPublisher port:
      │         ├── NotificationsRabbitMqModule      [FEATURE_RABBITMQ] → RabbitMqCollectorModule + RabbitMqPublishCollectorModule + consumer
      │         └── NotificationsEventEmitterModule  [default]          → in-process, no broker
      └── reads the GraphQL fields through the ProductReviewsLoader + ReviewerLoader ports:
            ├── ReviewLoadersDataLoaderModule [FEATURE_DATALOADER] → one $in query + one GET /users?id=… (request-scoped DataLoaders)
            └── ReviewLoadersDirectModule     [default]            → one query per product + one GET /users/:id per review (N+1)
                  └── both bind the ReviewerGateway port: ReviewerAxiosModule [HTTP_CLIENT=axios] | ReviewerFetchModule [HTTP_CLIENT=fetch]

Global: ProfilingModule [PROFILER_ENABLED] (core + config/validator/commander collectors)
        / ProfilerNoopModule [default], CacheModule, LoggerModule (pino, default)
```

The profiler is toggled with `ConditionalModule.registerWhen` — the recommended pattern (see below). The root-level profiler modules are bundled into one `ProfilingModule`, so `AppModule` keeps just two gates. Infra-scoped collectors stay co-located in their bounded context.

### The port + adapter pattern

Each context declares its outbound dependency as an `abstract class` (the DI token) and binds one implementation per adapter module. `CatalogModule` selects one persistence adapter by `SQL_ORM`:

```ts title="catalog/catalog.module.ts"
@Module({
  imports: [
    ConditionalModule.registerWhen(ProductTypeOrmModule, isSqlOrm('typeorm')),
    ConditionalModule.registerWhen(ProductMikroOrmModule, isSqlOrm('mikro-orm')),
    ConditionalModule.registerWhen(CatalogGraphQLModule, isGraphQLEnabled),
  ],
  controllers: [ProductController],
  providers: [ProductService, ProductResolver], // both inject the ProductRepository port
})
export class CatalogModule {}
```

```ts title="catalog/infrastructure/mikro-orm/product.mikro-orm.module.ts"
@Module({
  imports: [
    MikroOrmModule.forRootAsync({/* Postgres */}),
    MikroOrmModule.forFeature([ProductEntity]),
    ConditionalModule.registerWhen(
      MikroOrmCollectorModule.forRoot({ slowThreshold: 50 }),
      isProfilerEnabled,
    ),
  ],
  providers: [{ provide: ProductRepository, useClass: MikroOrmProductRepository }],
  exports: [ProductRepository],
})
export class ProductMikroOrmModule {}
```

The TypeORM adapter is identical in shape: same port, its own connection, its own collector. Swapping `SQL_ORM` swaps the whole persistence stack — and the Database panel's sub-tab with it — without the domain, application or transport layers noticing.

`ContentModule` applies the exact same idiom to the outgoing HTTP client: it selects `ArticleAxiosModule` or `ArticleFetchModule` by `HTTP_CLIENT`, each binding a different `ArticleGateway` implementation and registering its matching `HttpCollectorModule` adapter (`AxiosInstrumentation` / `FetchInstrumentation`).

### Toggling the profiler: one bundle + `ProfilerNoopModule`

`AppModule` toggles the profiler the recommended way, mirroring the port/adapter idiom above. The root-level profiler modules — the core `ProfilerModule` plus the global collectors (config, validator, commander) — are grouped into a single local `ProfilingModule`, so the composition root keeps just **two** gates: one loads the active bundle when `PROFILER_ENABLED` is on, the other loads `ProfilerNoopModule` otherwise. `TracerService` (injected in `ProductService`, the CLI commands, the content service…) therefore stays resolvable even when profiling is off, at no runtime cost.

```ts title="app.module.ts"
ConditionalModule.registerWhen(ProfilingModule.forWeb(), isProfilerEnabled),
ConditionalModule.registerWhen(
  ProfilerNoopModule.forRoot({ isGlobal: true }),
  (env) => !isProfilerEnabled(env),
),
```

```ts title="profiling/profiling.module.ts"
@Module({})
export class ProfilingModule {
  static forWeb(): DynamicModule {
    return {
      module: ProfilingModule,
      imports: [
        ProfilerModule.forRootAsync({ isGlobal: true /* storage, filters… */ }),
        ConfigCollectorModule.forRoot({ maskKeys: ['database.password'] }),
        // Panel only — the app owns the validation pipe in main.ts (see below).
        ValidatorCollectorModule.forRoot(),
        CommanderCollectorModule.forRoot(),
      ],
    };
  }
}
```

The bundle carries no `ConditionalModule` itself — the single outer gate covers the whole group, and none of the collectors needs a no-op counterpart (they self-register through discovery). Infra-scoped collectors (`HttpCollectorModule`, `MikroOrmCollectorModule`…) stay co-located in their bounded-context modules, gated there by their own feature flags on top of `isProfilerEnabled`.

Validation itself is **app-owned** so it survives the profiler being gated off — `main.ts` installs it directly, and the module above contributes only the Validator panel:

```ts title="main.ts"
app.useGlobalPipes(
  createProfilerValidationPipe(createClassValidatorPipe({ whitelist: true, transform: true })),
);
```

### Reviews → notifications: an event-driven flow

`ReviewService` depends on two ports — `ReviewRepository` (Mongoose) and `EventPublisher`. Creating a review publishes a `review.created` domain event:

```ts title="reviews/application/review.service.ts"
const review = await this.repo.create({ ...data, status: data.status ?? 'pending' });
await this.events.publish({ name: 'review.created', payload: { reviewId: review.id /* … */ } });
```

`ReviewApplicationModule` binds `EventPublisher` to the RabbitMQ adapter (`FEATURE_RABBITMQ=true`) or the in-process event-emitter adapter (default); `CatalogModule` always uses the latter. Each adapter also registers the handler that reacts to the event — the `@RabbitSubscribe` consumer or the `@OnEvent` listener — so `mongoose` + `rabbitmq`, or `event-emitter` alone, light up together through one realistic use case.

## Available endpoints

All business routes are served under the global prefix **`/api/v1`**. Only `GET /health`, the GraphQL endpoint (`/graphql`) and the profiler UI (`/_profiler`) stay at the root. Each row names the panel the call fills in `/_profiler`; the `curl` blocks below each table carry the payloads that are not obvious.

### Catalog (`CatalogModule` → active SQL ORM + GraphQL)

Seeded automatically at startup (4 products). REST and GraphQL share the same `ProductService`.

| Endpoint                      | What it demonstrates                                                         |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `GET /api/v1/products`        | **Database** — SELECT with type badge, duration bar, slow-query highlight    |
| `GET /api/v1/products/export` | **Database** — streaming read (`QueryBuilder.stream()`), flagged `streaming` |
| `GET /api/v1/products/:id`    | **Database** — SELECT by id, 404 when missing                                |
| `POST /api/v1/products`       | **Validator** + INSERT + `product.created` in the **Events** panel           |
| `PATCH /api/v1/products/:id`  | **Database** — an unknown id updates 0 rows, tagged `zero-rows`              |
| `DELETE /api/v1/products/:id` | **Database** — DELETE                                                        |
| `POST /graphql`               | **GraphQL** (GQL badge) — `products` / `product(id)` / `createProduct`       |

```bash
# Both adapters fill the Database tab; SQL_ORM=mikro-orm is the default, SQL_ORM=typeorm the other one.
curl http://localhost:3000/api/v1/products
curl -X POST http://localhost:3000/api/v1/products -H "Content-Type: application/json" \
  -d '{"name":"Widget","price":9.99}'
curl -X PATCH http://localhost:3000/api/v1/products/9999 -H "Content-Type: application/json" \
  -d '{"price":1}'   # 0 rows → zero-rows tag

curl -X POST http://localhost:3000/graphql -H "Content-Type: application/json" \
  -d '{"operationName":"GetProducts","query":"query GetProducts { products { id name price } }"}'
curl -X POST http://localhost:3000/graphql -H "Content-Type: application/json" \
  -d '{"operationName":"CreateProduct","query":"mutation CreateProduct($input: CreateProductInput!) { createProduct(input: $input) { id name } }","variables":{"input":{"name":"NestJS in Action","price":29.99}}}'

# Three sources in one operation (needs FEATURE_MONGOOSE=true): SQL + MongoDB + HTTP
curl -X POST http://localhost:3000/graphql -H "Content-Type: application/json" \
  -d '{"operationName":"Products","query":"query Products { products { id name reviews { rating comment author { name company } } } }"}'
```

### Content (`ContentModule` → HTTP (axios or fetch) + Cache + Validator)

| Endpoint                           | What it demonstrates                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/articles`             | **HTTP Client** + **Cache** — first call GET_MISS + N parallel calls → SET, then GET_HIT                |
| `GET /api/v1/articles/cache/clear` | **Cache** — DEL, forcing the next call back to a MISS                                                   |
| `POST /api/v1/articles/forward`    | **HTTP Client** — the only outgoing POST: request/response bodies captured. **Validator** on the way in |

```bash
curl http://localhost:3000/api/v1/articles          # MISS + HTTP calls + SET
curl http://localhost:3000/api/v1/articles          # HIT — no outgoing call
curl http://localhost:3000/api/v1/articles/cache/clear

# Valid DTO → 201 + the forwarded POST in the HTTP Client panel
curl -X POST http://localhost:3000/api/v1/articles/forward -H "Content-Type: application/json" \
  -d '{"title":"My article","body":"Body long enough to pass the MinLength(20) constraint."}'
# Invalid DTO → 400, violations in the Validator panel, no outgoing call
curl -X POST http://localhost:3000/api/v1/articles/forward -H "Content-Type: application/json" \
  -d '{"title":"Hi","body":"Too short"}'
```

### Reviews (`ReviewsModule` → Mongoose, `FEATURE_MONGOOSE=true`)

| Endpoint                                 | What it demonstrates                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `GET /api/v1/reviews`                    | **MongoDB** — `find`                                                   |
| `GET /api/v1/reviews/stats`              | **MongoDB** — `aggregate` (average rating per product)                 |
| `GET /api/v1/reviews/export`             | **MongoDB** — streaming read through a `cursor()`, flagged `streaming` |
| `GET /api/v1/reviews/product/:productId` | **MongoDB** — `find` by product                                        |
| `GET /api/v1/reviews/:id`                | **MongoDB** — `findById`, 404 when missing                             |
| `POST /api/v1/reviews`                   | **Validator** + insert + `review.created` (RabbitMQ or in-process)     |
| `DELETE /api/v1/reviews/:id`             | **MongoDB** — `deleteOne`                                              |

```bash
# requires FEATURE_MONGOOSE=true + docker compose up -d mongodb
curl http://localhost:3000/api/v1/reviews
curl -X POST http://localhost:3000/api/v1/reviews -H "Content-Type: application/json" \
  -d '{"productId":"1","rating":4,"comment":"Great product!","authorId":1}'
curl http://localhost:3000/api/v1/reviews/stats
```

### Auth (`AuthModule` → JWT)

| Endpoint                            | What it demonstrates                                  |
| ----------------------------------- | ----------------------------------------------------- |
| `GET /api/v1/auth/token?role=admin` | Issues a demo JWT (unsigned) and drops it in a cookie |
| `GET /api/v1/auth/me`               | **Security** — `JwtAuthGuard` decodes the Bearer JWT  |

```bash
TOKEN=$(curl -s "http://localhost:3000/api/v1/auth/token?role=admin" | jq -r .token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/auth/me
```

### Health (`HealthModule`) & Diagnostics (`DiagnosticsModule`)

| Endpoint            | What it demonstrates                                              |
| ------------------- | ----------------------------------------------------------------- |
| `GET /health`       | **Logs** — a profile whose only content is its log lines          |
| `GET /api/v1/slow`  | **Execution Trace** — 3 nested spans: fetch → process → serialize |
| `GET /api/v1/crash` | **Exceptions** — throws a 500 with a `cause`, tagged `error`      |

```bash
curl http://localhost:3000/api/v1/slow    # Trace: slow.step.* nested under slow.total
curl -i http://localhost:3000/api/v1/crash
```

There is deliberately no endpoint throwing a `BadRequestException`: rejecting an invalid `POST /api/v1/products` already produces a real 400 with a captured exception. It is a good way to see that a captured exception is not necessarily an error — the 400 shows up under the **Exception** filter, but not under the **Errors** checkbox, since the API answered correctly. See [What counts as an error](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/error-classification).

Any request also fills the **Config** tab with the `app.*` and `database.*` keys from the `registerAs` factories (`database.password` is masked).

## What `main.ts` wires

Two things, both visible in `examples/api/src/main.ts`.

### Automatic instrumentation

`createProfilerInstrument()` builds the `instanceDecorator` that `NestFactory` takes through its `instrument` option. Every provider method call then becomes a span, so the **Execution Trace** shows the full call tree — controller, service, repository — with the SQL nested under the method that issued it.

```ts title="main.ts"
const app = await NestFactory.create(AppModule, {
  bufferLogs: true,
  ...(instrumentEnabled ? { instrument: createProfilerInstrument({ exclude }) } : {}),
});
```

It is **on by default here and off by default in the library**, and the difference is deliberate: this app exists to show what the profiler can do, and the call tree is invisible without it. In your own application it proxies every provider, so every property access goes through a trap whether or not the request is profiled — a demo's cost to pay, not a production application's. Set `PROFILER_INSTRUMENT=false` to see a trace as an application that has not opted in sees it.

Recording every call also records the boring ones. `PROFILER_INSTRUMENT_EXCLUDE` feeds the `exclude` option, which takes classes and methods off the trace by name — `PROFILER_INSTRUMENT_EXCLUDE='ConfigService,*.getRequestId'` drops the whole class in the first case and that one method, on every class, in the second. Empty here, because this app has no such noise; a real one usually does.

### Log capture

The log collector is **logger-agnostic**: `createProfilerLogger()` wraps any `LoggerService`, so capture works with NestJS's `ConsoleLogger` or a third-party logger such as `nestjs-pino`. `FEATURE_PINO_LOGGER` toggles which one is used — no profiler code changes.

```ts title="main.ts"
const baseLogger: LoggerService = isPinoLoggerEnabled
  ? app.get(PinoLogger) // nestjs-pino
  : new ConsoleLogger('ExampleApi'); // NestJS default

app.useLogger(createProfilerLogger(baseLogger));
await app.listen(port);
```

`createProfilerLogger` is **DI-free** — it reads the active profile from the CLS store — so it needs no service to be resolved and stays a transparent pass-through when the profiler is off.

### Capturing a directly-injected logger

`app.useLogger()` only captures logs flowing through NestJS's `Logger`. `ArticleService` shows the other case: it injects `nestjs-pino`'s `PinoLogger` directly and wraps it with `createProfilerLogger(pinoLogger)`, so even pino's own `info()` is captured. Run in pino mode (`FEATURE_PINO_LOGGER=true`), call `GET /api/v1/articles`, and check the **Logs** tab.

Open `http://localhost:3000/_profiler` to browse all profiles.
