# example-api

`examples/api` is a feature-complete NestJS application demonstrating every built-in `nest-profiler` collector. It is organised as a small **marketplace backend** split into bounded contexts, each following **clean architecture / DDD** (domain / application / http / infrastructure) — the same shape across the whole app, not just one module.

The composition root (`app.module.ts`) holds **no controller and no feature logic** — only cross-cutting `forRoot`/global registrations and imports of the feature modules. Every context exposes its persistence/transport tech behind a **port** (an `abstract class` used as the DI token), so an adapter can be swapped by one environment variable without touching the domain, application or transport layers.

## Live demo

A live instance is deployed **without any database or broker** — this is the minimal set that runs with zero infrastructure (e.g. on Vercel):

```
SQL_ORM=in-memory       # catalog runs on an in-memory adapter (no PostgreSQL)
FEATURE_MONGOOSE=false  # reviews / MongoDB disabled
FEATURE_RABBITMQ=false  # no broker
FEATURE_GRAPHQL=true    # GraphQL served over the in-memory catalog
PROFILER_STORAGE_TYPE=memory
```

Active collectors on the live demo: **Catalog** (in-memory, REST + **GraphQL**), **Content** (HTTP + Cache), **Auth**, **Config**, **Validator**.

| Endpoint                 | URL                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Swagger UI               | [nest-profiler-example.eleven-labs.com/api](https://nest-profiler-example.eleven-labs.com/api)              |
| Apollo Sandbox (GraphQL) | [nest-profiler-example.eleven-labs.com/graphql](https://nest-profiler-example.eleven-labs.com/graphql)      |
| Profiler UI              | [nest-profiler-example.eleven-labs.com/\_profiler](https://nest-profiler-example.eleven-labs.com/_profiler) |

## Getting started

### Prerequisites

- Node.js 22+, pnpm 10+
- Docker (optional — only needed when `SQL_ORM` is a database ORM, or `FEATURE_MONGOOSE`/`FEATURE_RABBITMQ` are enabled)

### Start the infrastructure

A `docker-compose.yml` is provided at the **project root**:

```bash
docker compose up -d
```

This starts **PostgreSQL 16** (`5432`) for the SQL ORM collectors, **MongoDB 7** (`27017`) for the Mongoose collector, and **RabbitMQ** (`5672`) for the messaging collector.

### Feature flags

The app uses flags to conditionally load infrastructure-dependent contexts. All infra-backed features are **off by default**, so a bare run needs no database or broker. Set them in `.env`:

| Variable                | Default     | Description                                                                        |
| ----------------------- | ----------- | ---------------------------------------------------------------------------------- |
| `SQL_ORM`               | `in-memory` | Catalog persistence adapter: `in-memory` \| `typeorm` \| `mikro-orm`               |
| `HTTP_CLIENT`           | `axios`     | Content HTTP client / profiler adapter: `axios` \| `fetch`                         |
| `FEATURE_MONGOOSE`      | `false`     | Load the Mongoose-backed `ReviewsModule` (needs MongoDB)                           |
| `FEATURE_GRAPHQL`       | `true`      | Expose the catalog over GraphQL (served over any catalog adapter, no infra)        |
| `FEATURE_RABBITMQ`      | `false`     | Publish `review.created` to RabbitMQ + run the consumer (`nest-profiler-rabbitmq`) |
| `FEATURE_PINO_LOGGER`   | `false`     | Use the third-party `nestjs-pino` logger instead of `ConsoleLogger`                |
| `PROFILER_ENABLED`      | `true`      | Enable the profiler UI and all collectors                                          |
| `PROFILER_STORAGE_TYPE` | `file`      | Profiler storage backend: `memory` \| `file` \| `sqlite`                           |
| `PROFILER_AUTH`         | `none`      | Access control for `/_profiler`: `none` \| `basic` \| `token` \| `cookie`          |

`PROFILER_AUTH` selects how the demo protects the `/_profiler` dashboard — the consumer-side counterpart of the profiler's pluggable [`security`](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#securing-the-ui) option, chosen by env exactly like `SQL_ORM`. `none` (default) leaves it open; `basic` uses HTTP Basic auth (`PROFILER_BASIC_USER` / `PROFILER_BASIC_PASSWORD`); `token` checks a bearer or `?token=<PROFILER_TOKEN>` credential (the query is threaded across UI links via `linkQuery`); and `cookie` reuses the app's own `JwtAuthGuard` through `security.guards` — the guard reads the JWT from the `profiler_jwt` cookie that `GET /api/v1/auth/token` sets, so the browser sends it on every link and the whole UI is navigable (a `Bearer` header is still accepted for `curl`). Because navigation happens through plain links, prefer `basic`, `cookie` or a session for browser access (the browser propagates those automatically); a pure `token` header suits `curl`.

`PROFILER_STORAGE_TYPE=sqlite` uses the built-in libSQL-backed `SqliteStorageAdapter`. It targets a local file by default (`PROFILER_STORAGE_PATH`); set `PROFILER_STORAGE_URL` (+ `PROFILER_STORAGE_AUTH_TOKEN`) to point the same adapter at a remote SQLite database such as Turso Cloud — required on serverless hosts like Vercel, where the filesystem is read-only. On Vercel these fall back to the Turso integration's `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`.

`SQL_ORM` selects which adapter backs the **catalog** context. `typeorm`/`mikro-orm` are mutually exclusive (they map the same Postgres `products` table); `in-memory` needs no database and is the default, so the catalog — and its GraphQL API — always runs. Contexts that depend on disabled infrastructure are simply not registered: no connection is attempted, no crash.

PostgreSQL can be configured with the app-specific `DATABASE_HOST` / `DATABASE_PORT` / `DATABASE_USER` / `DATABASE_PASSWORD` / `DATABASE_NAME` variables. Hosted Vercel Neon integrations also work without aliases: the app falls back to `POSTGRES_*` and `PG*` variables, and enables SSL when `DATABASE_SSL=true` or `PGSSLMODE=require`. The demo ships no migrations, so the ORM creates the `products` table automatically on boot; the destructive drop-and-recreate only runs outside production, so a deployed database keeps its structure across cold starts.

`HTTP_CLIENT` selects which adapter backs the **content** context's `ArticleGateway` — `axios` (via `@nestjs/axios`, the default) or native `fetch`. The two are interchangeable and profiled the same way; switching only changes which HTTP Client instrumentation captures the calls (`AxiosInstrumentation` vs `FetchInstrumentation`). Same pattern as `SQL_ORM`, applied to the outgoing HTTP client.

```bash
# Everything on (needs docker compose up -d)
SQL_ORM=typeorm FEATURE_MONGOOSE=true FEATURE_RABBITMQ=true pnpm example:dev

# Profile SQL queries through MikroORM instead of TypeORM
SQL_ORM=mikro-orm FEATURE_MONGOOSE=true pnpm example:dev

# Profile outgoing HTTP through native fetch instead of axios
HTTP_CLIENT=fetch pnpm example:dev

# Minimal, no infrastructure (Catalog in-memory + GraphQL, Content, Auth, Config, Validator)
pnpm example:dev

# Without GraphQL
FEATURE_GRAPHQL=false pnpm example:dev
```

When `FEATURE_RABBITMQ=true`, creating a review (`POST /api/v1/reviews`) publishes a `review.created` event through the `EventPublisher` port; the RabbitMQ adapter forwards it to the broker and a `@RabbitSubscribe` consumer reacts to it — profiled as a `rabbitmq` entrypoint with its own **Message** tab. With the flag off, the port is bound to a no-op publisher, so reviews still work without a broker.

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

Open **[http://localhost:3000/graphql](http://localhost:3000/graphql)**. The schema is auto-generated from the catalog resolver, backed by whichever `SQL_ORM` adapter is active (in-memory by default):

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

Each operation generates a profile with a **GQL** badge. The **Timeline** tab shows the `db.products.*` spans — declared once in `ProductService` and shared by the REST and GraphQL entrypoints.

## Module architecture

Every context is layered (domain / application / http / infrastructure); the composition root only wires them:

```
AppModule (no controller — only global forRoot + feature modules)
├── CatalogModule            products aggregate, REST + GraphQL
│     ├── ProductInMemoryModule  [SQL_ORM=in-memory, default]  → no infrastructure
│     ├── ProductTypeOrmModule   [SQL_ORM=typeorm]   → TypeOrmCollectorModule  (nest-profiler-typeorm)
│     ├── ProductMikroOrmModule  [SQL_ORM=mikro-orm] → MikroOrmCollectorModule (nest-profiler-mikro-orm)
│     └── CatalogGraphQLModule   [FEATURE_GRAPHQL]   → ProfilerGraphQLModule   (nest-profiler-graphql) + Apollo
├── ContentModule            /api/v1/articles + content:sync CLI → CacheCollectorModule
│     ├── ArticleAxiosModule    [HTTP_CLIENT=axios, default] → HttpCollectorModule (AxiosInstrumentation) + @nestjs/axios
│     └── ArticleFetchModule    [HTTP_CLIENT=fetch]          → HttpCollectorModule (FetchInstrumentation)
├── AuthModule               → AuthCollectorModule (nest-profiler-auth)
├── HealthModule             → GET /health
├── DiagnosticsModule        → GET /api/v1/slow, /api/v1/crash + demo:greet CLI
└── ReviewsModule [FEATURE_MONGOOSE]  → MongooseCollectorModule (nest-profiler-mongoose)
      └── publishes review.created via the EventPublisher port:
          ├── NotificationsRabbitMqModule [FEATURE_RABBITMQ] → RabbitMqCollectorModule + consumer
          └── NotificationsNoopModule     [default]          → no broker

Global: ProfilingModule [PROFILER_ENABLED] (core + config/validator/commander collectors)
        / ProfilerNoopModule [default], CacheModule, LoggerModule (pino, opt-in)
```

The profiler is toggled with `ConditionalModule.registerWhen` — the recommended pattern (see below). The root-level profiler modules are bundled into one `ProfilingModule`, so `AppModule` keeps just two gates. Infra-scoped collectors stay co-located in their bounded context.

### The port + adapter pattern

Each context declares its outbound dependency as an `abstract class` (the DI token) and binds one implementation per adapter module. `CatalogModule` selects one persistence adapter by `SQL_ORM`:

```ts title="catalog/catalog.module.ts"
@Module({
  imports: [
    ConditionalModule.registerWhen(ProductInMemoryModule, isSqlOrm('in-memory')),
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
      MikroOrmCollectorModule.forRoot({ slowQueryThreshold: 50 }),
      isProfilerEnabled,
    ),
  ],
  providers: [{ provide: ProductRepository, useClass: MikroOrmProductRepository }],
  exports: [ProductRepository],
})
export class ProductMikroOrmModule {}
```

The `in-memory` adapter is identical in shape but binds `InMemoryProductRepository` and wires no connection or collector — that is the path that keeps the catalog (REST + GraphQL) running with no infrastructure.

`ContentModule` applies the exact same idiom to the outgoing HTTP client: it selects `ArticleAxiosModule` or `ArticleFetchModule` by `HTTP_CLIENT`, each binding a different `ArticleGateway` implementation and registering its matching `HttpCollectorModule` adapter (`AxiosInstrumentation` / `FetchInstrumentation`).

### Toggling the profiler: one bundle + `ProfilerNoopModule`

`AppModule` toggles the profiler the recommended way, mirroring the port/adapter idiom above. The root-level profiler modules — the core `ProfilerModule` plus the global collectors (config, validator, commander) — are grouped into a single local `ProfilingModule`, so the composition root keeps just **two** gates: one loads the active bundle when `PROFILER_ENABLED` is on, the other loads `ProfilerNoopModule` otherwise. `ProfilerService` (injected in `main.ts`, `ProductService`, the CLI commands, the content service…) therefore stays resolvable even when profiling is off, at no runtime cost.

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

`ReviewsModule` binds `EventPublisher` to the RabbitMQ adapter (`FEATURE_RABBITMQ=true`) or the no-op adapter (default). The RabbitMQ adapter also registers the `@RabbitSubscribe` consumer that reacts to the event — so `mongoose` and `rabbitmq` collectors light up together through one realistic use case.

## Available endpoints

All business routes are served under the global prefix **`/api/v1`**. Only `GET /health`, the GraphQL endpoint (`/graphql`) and the profiler UI (`/_profiler`) stay at the root.

### Health (`HealthModule`) & Diagnostics (`DiagnosticsModule`)

| Endpoint            | Collector demo | Description                                              |
| ------------------- | -------------- | -------------------------------------------------------- |
| `GET /health`       | Logs           | Health check with timestamp                              |
| `GET /api/v1/slow`  | Timeline       | 3 nested spans: fetch → process → serialize              |
| `GET /api/v1/crash` | Exceptions     | Throws a 500 — tagged `error`, kept by the Errors filter |

There is deliberately no endpoint throwing a `BadRequestException`: rejecting an invalid `POST /api/v1/products` already produces a real 400 with a captured exception. It is a good way to see that a captured exception is not necessarily an error — the 400 shows up under the **Exception** filter, but not under the **Errors** checkbox, since the API answered correctly. See [What counts as an error](https://nestjs-profiler-module.vercel.app/en/docs/packages/nest-profiler/error-classification).

### Catalog (`CatalogModule` → active SQL ORM + GraphQL)

Seeded automatically at startup (4 products). REST and GraphQL share the same `ProductService`.

| Endpoint                      | Description                                  |
| ----------------------------- | -------------------------------------------- |
| `GET /api/v1/products`        | List all products                            |
| `GET /api/v1/products/:id`    | Get by ID                                    |
| `POST /api/v1/products`       | Create product (Validator collector)         |
| `DELETE /api/v1/products/:id` | Delete product                               |
| `POST /graphql`               | `products` / `product(id)` / `createProduct` |

### Content (`ContentModule` → HTTP (axios or fetch) + Cache + Validator)

| Endpoint                           | Description                                                          |
| ---------------------------------- | -------------------------------------------------------------------- |
| `GET /api/v1/articles`             | First call: GET_MISS + HTTP (N+1 authors) → SET. Subsequent: GET_HIT |
| `POST /api/v1/articles`            | Create with `CreateArticleDto` — valid/invalid via Validator panel   |
| `POST /api/v1/articles/forward`    | Forward via a POST — request/response body + headers in HTTP Client  |
| `GET /api/v1/articles/cache/clear` | Clear the articles cache (force next MISS)                           |
| `GET /api/v1/articles/todos/:id`   | Per-item cached todo (two concurrent HTTP calls)                     |

### Reviews (`ReviewsModule` → Mongoose, `FEATURE_MONGOOSE=true`)

| Endpoint                                 | Description                                       |
| ---------------------------------------- | ------------------------------------------------- |
| `GET /api/v1/reviews`                    | List all reviews (Mongoose `find`)                |
| `GET /api/v1/reviews/stats`              | Average rating per product (Mongoose `aggregate`) |
| `GET /api/v1/reviews/product/:productId` | Reviews for a product                             |
| `GET /api/v1/reviews/:id`                | Get by ID                                         |
| `POST /api/v1/reviews`                   | Create a review — publishes `review.created`      |
| `DELETE /api/v1/reviews/:id`             | Delete a review                                   |

### Auth (`AuthModule` → JWT)

| Endpoint                            | Description                         |
| ----------------------------------- | ----------------------------------- |
| `GET /api/v1/auth/token?role=admin` | Generate demo JWT (unsigned)        |
| `GET /api/v1/auth/me`               | Decodes Bearer JWT → `request.user` |

## Testing each collector

### SQL ORM — Database tab

```bash
# default is in-memory (no DB). For SQL: SQL_ORM=typeorm (or mikro-orm) pnpm example:dev
curl http://localhost:3000/api/v1/products
curl -X POST http://localhost:3000/api/v1/products -H "Content-Type: application/json" \
  -d '{"name":"Widget","price":9.99}'
```

→ **Database** tab: SQL queries with type badge, duration bar, slow-query highlighting — rendered identically for both ORMs (shared `AbstractSqlQueryCollector`). With `SQL_ORM=in-memory` there is no Database tab; the catalog still works.

### Axios + Cache — HTTP Client and Cache tabs

```bash
curl http://localhost:3000/api/v1/articles          # MISS + HTTP calls + SET
curl http://localhost:3000/api/v1/articles          # HIT — no outgoing call
curl http://localhost:3000/api/v1/articles/cache/clear
```

### Mongoose — MongoDB tab

```bash
# requires FEATURE_MONGOOSE=true + docker compose up -d mongodb
curl http://localhost:3000/api/v1/reviews
curl -X POST http://localhost:3000/api/v1/reviews -H "Content-Type: application/json" \
  -d '{"productId":"1","rating":4,"comment":"Great product!","author":"Alice"}'
curl http://localhost:3000/api/v1/reviews/stats
```

### Auth — Security tab

```bash
TOKEN=$(curl -s "http://localhost:3000/api/v1/auth/token?role=admin" | jq -r .token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/auth/me
```

### Validator — Validator tab

```bash
# Valid DTO
curl -X POST http://localhost:3000/api/v1/articles -H "Content-Type: application/json" \
  -d '{"title":"My article","body":"Body long enough to pass the MinLength(20) constraint."}'
# Invalid DTO — shows violations
curl -X POST http://localhost:3000/api/v1/articles -H "Content-Type: application/json" \
  -d '{"title":"Hi","body":"Too short"}'
```

### GraphQL — Request tab (GQL badge)

```bash
curl -X POST http://localhost:3000/graphql -H "Content-Type: application/json" \
  -d '{"operationName":"GetProducts","query":"query GetProducts { products { id name price } }"}'

curl -X POST http://localhost:3000/graphql -H "Content-Type: application/json" \
  -d '{"operationName":"CreateProduct","query":"mutation CreateProduct($input: CreateProductInput!) { createProduct(input: $input) { id name } }","variables":{"input":{"name":"NestJS in Action","price":29.99}}}'
```

### Timeline & Config tabs

```bash
curl http://localhost:3000/api/v1/slow   # Timeline: slow.step.* + slow.total spans
```

Any request → **Config** tab shows `app.*` and `database.*` keys from `registerAs` factories (`database.password` is masked).

## Log capture in `main.ts`

The profiler's log collector is **logger-agnostic**: `profilerService.createLogger()` wraps any `LoggerService`, so capture works with NestJS's `ConsoleLogger` or a third-party logger such as `nestjs-pino`. `FEATURE_PINO_LOGGER` toggles which one is used — no profiler code changes.

```ts title="main.ts"
const app = await NestFactory.create(AppModule, { bufferLogs: true });
const profilerService = app.get(ProfilerService);

const baseLogger = isPinoLoggerEnabled(process.env)
  ? app.get(PinoLogger) // nestjs-pino
  : new ConsoleLogger('ExampleApi'); // NestJS default

app.useLogger(profilerService.createLogger(baseLogger));
await app.listen(port);
```

### Capturing a directly-injected logger

`app.useLogger()` only captures logs flowing through NestJS's `Logger`. `ArticleService` shows the other case: it injects `nestjs-pino`'s `PinoLogger` directly and wraps it with `profiler.createLogger(pinoLogger)`, so even pino's own `info()` is captured. Run in pino mode (`FEATURE_PINO_LOGGER=true`), call `GET /api/v1/articles`, and check the **Logs** tab.

Open `http://localhost:3000/_profiler` to browse all profiles.
