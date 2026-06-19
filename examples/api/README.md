# example-api

The `examples/api` directory contains a feature-complete NestJS application demonstrating every built-in collector. Collectors that wrap an external concern live in **one feature module per package**; the `products` context is structured with **hexagonal architecture** so a single SQL ORM (TypeORM or MikroORM) can be swapped via one environment variable without touching the domain, application, or HTTP layers.

## Live demo

A live instance is deployed with the following configuration — no database infrastructure, in-memory storage only:

```
SQL_ORM=none                # no SQL ORM / PostgreSQL (products context disabled)
FEATURE_MONGOOSE=false      # ReviewsModule and MongoDB disabled
PROFILER_ENABLED=true
PROFILER_STORAGE_TYPE=memory
```

Active collectors on the live demo: **Posts** (HTTP + Cache), **Auth**, **Config**, **Validator**, **GraphQL** (Books).

| Endpoint                 | URL                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Swagger UI               | [nest-profiler-example.eleven-labs.com/api](https://nest-profiler-example.eleven-labs.com/api)              |
| Apollo Sandbox (GraphQL) | [nest-profiler-example.eleven-labs.com/graphql](https://nest-profiler-example.eleven-labs.com/graphql)      |
| Profiler UI              | [nest-profiler-example.eleven-labs.com/\_profiler](https://nest-profiler-example.eleven-labs.com/_profiler) |

## Getting started

### Prerequisites

- Node.js 22+, pnpm 10+
- Docker (optional — only needed when `SQL_ORM` is set to a database ORM or `FEATURE_MONGOOSE` is enabled)

### Start the infrastructure

A `docker-compose.yml` is provided at the **project root**:

```bash
docker compose up -d
```

This starts **PostgreSQL 16** on port `5432` for the TypeORM collector demo, and **MongoDB 7** on port `27017` for the Mongoose collector demo.

### Feature flags

The example app uses flags to conditionally load infrastructure-dependent modules. Set them in `.env`:

| Variable              | Default   | Description                                                          |
| --------------------- | --------- | -------------------------------------------------------------------- |
| `SQL_ORM`             | `typeorm` | SQL ORM for the products context: `typeorm` \| `mikro-orm` \| `none` |
| `FEATURE_MONGOOSE`    | `true`    | Load Mongoose + MongoDB connection + `ReviewsModule`                 |
| `FEATURE_GRAPHQL`     | `true`    | Load GraphQL + Apollo Server + `BooksModule`                         |
| `FEATURE_RABBITMQ`    | `false`   | Load the RabbitMQ consumer/producer + `nest-profiler-rabbitmq`       |
| `FEATURE_PINO_LOGGER` | `false`   | Use the third-party `nestjs-pino` logger instead of `ConsoleLogger`  |
| `PROFILER_ENABLED`    | `true`    | Enable the profiler UI and all collectors                            |

`SQL_ORM` selects which persistence adapter backs the products context — the adapters are mutually exclusive because they map the same Postgres `products` table. Set it to `none` to disable the products context entirely. Set `FEATURE_MONGOOSE=false` to disable the reviews context. Modules that depend on disabled infrastructure are simply not registered — no connection is attempted, no crash.

```bash
# Profile SQL queries through MikroORM instead of TypeORM
SQL_ORM=mikro-orm pnpm example:dev

# Run without any database (Posts, Auth, Config, Validator, GraphQL collectors still active)
SQL_ORM=none FEATURE_MONGOOSE=false pnpm example:dev

# Run without GraphQL
FEATURE_GRAPHQL=false pnpm example:dev

# Profile RabbitMQ messages (start the broker first: docker compose up -d rabbitmq)
FEATURE_RABBITMQ=true pnpm example:dev
```

With `FEATURE_RABBITMQ=true`, `POST /notifications` publishes a message that a `@RabbitSubscribe` handler consumes; the consumed message is profiled as a `rabbitmq` entrypoint — open `/_profiler` to see it in the **RabbitMQ** table with its own **Message** tab.

### Run the application

```bash
pnpm example:dev
```

The API starts on port `3000`. Copy `.env.example` to `.env` to customise the database connection.  
Profiles are persisted to `.profiler/` (file storage) — they survive restarts.

### Profiling CLI commands (`nest-profiler-commander`)

A separate CLI entrypoint (`src/cli.ts` → `CliModule`) demonstrates profiling `nest-commander`
commands. It writes to the same `.profiler/` file storage as the HTTP app, so the command runs
show up at `/_profiler` next to the HTTP profiles — the console equivalent of Symfony's command
profiling.

```bash
pnpm --filter example-api build

# Fetches posts via axios and caches them — the profile shows Command + HTTP Client + Cache panels
FEATURE_TYPEORM=false FEATURE_MONGOOSE=false pnpm --filter example-api cli sync:posts --limit 3

# A trivial command; add --fail to produce a failed profile (Exceptions tab)
FEATURE_TYPEORM=false FEATURE_MONGOOSE=false pnpm --filter example-api cli demo:greet --name Fabien
```

Then start the HTTP app (`pnpm example:dev`) and open `/_profiler` to inspect the command profiles
(listed with a `CLI` method badge). Commands are wrapped automatically — `SyncPostsCommand` and
`GreetCommand` are ordinary `nest-commander` commands with no profiling code.

## Exploring the API

### Swagger UI

Open **[http://localhost:3000/api](http://localhost:3000/api)** to access the interactive Swagger UI. Every endpoint is documented with its parameters, request body, and expected responses.

#### Testing authenticated endpoints

The `/auth/me` endpoint requires a Bearer JWT. The built-in `/auth/token` shortcut generates a demo token in one click:

1. Call **`GET /auth/token`** — pick a role (`user`, `admin`, `moderator`) and execute.
2. Copy the `token` value from the response.
3. Click **Authorize** (top right), paste the token, and confirm.
4. Call **`GET /auth/me`** — the JWT is sent automatically.

> **Note:** The authorization is persisted across page reloads (`persistAuthorization: true`), so you only need to set it once per session.

#### Swagger + profiler

Every request sent through Swagger UI generates a full profiler profile. After executing any call, copy the `X-Debug-Token` response header value and open `/_profiler/{token}` to inspect the collected data — SQL queries, cache operations, validation results, and more.

### Apollo Sandbox

Open **[http://localhost:3000/graphql](http://localhost:3000/graphql)** to access the Apollo Sandbox. The schema is auto-generated from the `BooksModule` resolvers.

Available operations:

```graphql
query GetBooks {
  books {
    id
    title
    author
    publishedYear
  }
}

query GetBook($id: ID!) {
  book(id: $id) {
    id
    title
    author
    publishedYear
  }
}

mutation CreateBook($title: String!, $author: String!, $publishedYear: Int) {
  createBook(input: { title: $title, author: $author, publishedYear: $publishedYear }) {
    id
    title
    author
    publishedYear
  }
}
```

Each operation sent through the Sandbox generates a profiler profile with a **GQL** badge. Open `/_profiler` to inspect the operation type, name, syntax-highlighted query and variables in the **Request** tab.

## Module architecture

The products context is hexagonal; every other feature module owns the collector(s) it demonstrates:

```
AppModule
├── ProductModule  → selects ONE adapter by SQL_ORM (mutually exclusive):
│     ├── ProductTypeOrmModule   [SQL_ORM=typeorm]   → TypeOrmCollectorModule (nest-profiler-typeorm)
│     └── ProductMikroOrmModule  [SQL_ORM=mikro-orm] → MikroOrmCollectorModule (nest-profiler-mikro-orm)
│           (both bind the same ProductRepository port; SQL_ORM=none loads neither)
├── MongoModule [FEATURE_MONGOOSE]
│   └── ReviewsModule   → MongooseCollectorModule (nest-profiler-mongoose)
├── AppGraphQLModule [FEATURE_GRAPHQL]
│   └── BooksModule     → ProfilerGraphQLModule (nest-profiler-graphql) + Apollo Server
├── PostsModule     → HttpCollectorModule (nest-profiler-http) + CacheCollectorModule
│                     uses global ValidatorCollectorModule (POST /posts)
├── AuthModule      → AuthCollectorModule (nest-profiler-auth)
├── ConfigCollectorModule  (nest-profiler-config, global)
└── ValidatorCollectorModule (nest-profiler-validator, global APP_PIPE)
```

### AppModule — global infrastructure

`AppModule` loads `ProductModule` (unless `SQL_ORM=none`) and `MongoModule` conditionally via `ConditionalModule.registerWhen` (conditions evaluated after `.env` is loaded). The SQL ORM selection itself lives inside `ProductModule`.

```ts title="app.module.ts"
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, featuresConfig],
    }),
    ConditionalModule.registerWhen(ProductModule, isSqlOrmEnabled), // skipped when SQL_ORM=none
    ConditionalModule.registerWhen(MongoModule, isMongooseEnabled),
    CacheModule.register({ isGlobal: true, ttl: 30000 }),
    ProfilerModule.forRoot({ isGlobal: true, storageType: 'file', storagePath: '.profiler' }),
    ConfigCollectorModule.forRoot({ maskKeys: ['database.password'] }),
    ValidatorCollectorModule.forRoot({ whitelist: true, transform: true }),
    AuthModule,
    PostsModule,
  ],
})
export class AppModule {}
```

`ProductModule` owns the HTTP + application layers and selects one adapter; each adapter only provides the `ProductRepository` port, which it **exports** up through `ConditionalModule`:

```ts title="products/product.module.ts"
@Module({
  imports: [
    ConditionalModule.registerWhen(ProductTypeOrmModule, isSqlOrm('typeorm')),
    ConditionalModule.registerWhen(ProductMikroOrmModule, isSqlOrm('mikro-orm')),
  ],
  controllers: [ProductController],
  providers: [ProductService], // injects ProductRepository, exported by the active adapter
})
export class ProductModule {}
```

### Products context — hexagonal, demonstrates `nest-profiler-typeorm` / `nest-profiler-mikro-orm`

The `products/` folder separates the technology-agnostic core from the ORM-specific infrastructure:

```
products/
├── product.module.ts    controller + service; selects one adapter by SQL_ORM (ConditionalModule)
├── domain/         product.ts, product.repository.ts  (ProductRepository port = DI token)
├── application/    product.service.ts                 (depends only on the port)
├── http/           product.controller.ts, dto/
└── infrastructure/
    ├── typeorm/     product.typeorm.{entity,repository,module}.ts   (+ TypeOrmCollectorModule)
    └── mikro-orm/   product.mikro-orm.{entity,repository,module}.ts (+ MikroOrmCollectorModule)
```

Each infrastructure module's only role is to wire its ORM connection + collector and **provide + export** the port — the controller/service stay in `ProductModule`:

```ts title="products/infrastructure/mikro-orm/product.mikro-orm.module.ts"
@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      /* Postgres, driver: PostgreSqlDriver */
    }),
    MikroOrmModule.forFeature([ProductEntity]),
    MikroOrmCollectorModule.forRoot({ slowQueryThreshold: 50 }),
  ],
  providers: [{ provide: ProductRepository, useClass: MikroOrmProductRepository }],
  exports: [ProductRepository],
})
export class ProductMikroOrmModule {}
```

### PostsModule — demonstrates `nest-profiler-http` + `nest-profiler-cache` + `nest-profiler-validator`

```ts title="posts/posts.module.ts"
@Module({
  imports: [
    HttpModule, // provides HttpService for the bundled axios adapter
    HttpCollectorModule.forRoot({ captureResponseBody: true }),
    CacheCollectorModule.forRoot(),
  ],
  controllers: [PostsController],
  providers: [PostsService, PostsFetchService],
})
export class PostsModule {}
```

`PostsController` stays thin — it only maps routes to two dedicated services. `PostsService` holds the axios (`HttpService`) + cache logic, while `PostsFetchService` makes a native `fetch` call and records it with `HttpProfilerRecorder.capture(...)` — so the **HTTP Client** panel shows axios and fetch calls side by side. The global `ProfilerValidationPipe` registered by `ValidatorCollectorModule` intercepts `CreatePostDto` automatically.

### ReviewsModule — demonstrates `nest-profiler-mongoose`

```ts title="reviews/reviews.module.ts"
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Review.name, schema: ReviewSchema }]),
    MongooseCollectorModule.forRoot({ slowQueryThreshold: 50 }),
  ],
})
export class ReviewsModule {}
```

`ReviewsService` uses both `Model.find()` and `Model.aggregate()` — the Mongoose collector captures both query types.

### AppGraphQLModule — demonstrates `nest-profiler-graphql`

```ts title="graphql.module.ts"
@Module({
  imports: [
    ProfilerGraphQLModule.forRoot(),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      context: ({ req }) => ({ req }), // exposes the request to the profiler adapter
    }),
    BooksModule,
  ],
})
export class AppGraphQLModule {}
```

`BooksModule` exposes two queries (`books`, `book`) and one mutation (`createBook`). Each resolver wraps its business logic in `profilerService.startSpan()` so Timeline spans are captured alongside the GraphQL profiling data.

### AuthModule — demonstrates `nest-profiler-auth`

```ts title="auth/auth.module.ts"
@Module({
  imports: [AuthCollectorModule.forRoot({ maskUserFields: ['password', 'refreshToken'] })],
})
export class AuthModule {}
```

## Available endpoints

### Core (`AppController`)

| Endpoint      | Collector demo | Description                                 |
| ------------- | -------------- | ------------------------------------------- |
| `GET /health` | Logs           | Health check with timestamp                 |
| `GET /slow`   | Timeline       | 3 nested spans: fetch → process → serialize |
| `GET /error`  | Exceptions     | Throws `BadRequestException`                |

### Products (hexagonal → active SQL ORM)

The database is seeded automatically at startup — no manual step required. The schema is recreated and the seed inserts 4 products on every restart, so switching `SQL_ORM` always starts clean.

| Endpoint               | Description                           |
| ---------------------- | ------------------------------------- |
| `GET /products`        | List all products (SELECT + ORDER BY) |
| `GET /products/:id`    | Get by ID (SELECT + WHERE)            |
| `POST /products`       | Create product                        |
| `DELETE /products/:id` | Delete product (SELECT + DELETE)      |

### Posts (`PostsModule` → HTTP (axios + fetch) + Cache + Validator)

| Endpoint                 | Description                                                              |
| ------------------------ | ------------------------------------------------------------------------ |
| `GET /posts`             | First call: GET_MISS + axios → SET. Subsequent: GET_HIT                  |
| `POST /posts`            | Create with `CreatePostDto` — captures valid/invalid via Validator panel |
| `POST /posts/forward`    | Forward via axios POST — request/response body + headers in HTTP Client  |
| `GET /posts/via-fetch`   | Native `fetch` (no axios), recorded via `HttpProfilerRecorder.capture()` |
| `GET /posts/cache/clear` | Clear posts cache (force next MISS)                                      |
| `GET /posts/todos/:id`   | Per-item cached todo from JSONPlaceholder                                |

### Reviews (`ReviewsModule` → Mongoose)

| Endpoint                          | Description                                       |
| --------------------------------- | ------------------------------------------------- |
| `GET /reviews`                    | List all reviews (Mongoose `find`)                |
| `GET /reviews/stats`              | Average rating per product (Mongoose `aggregate`) |
| `GET /reviews/product/:productId` | Reviews for a product                             |
| `GET /reviews/:id`                | Get by ID                                         |
| `POST /reviews`                   | Create a review — captured by Validator collector |
| `DELETE /reviews/:id`             | Delete a review                                   |

### Auth (`AuthModule` → JWT)

| Endpoint                     | Description                         |
| ---------------------------- | ----------------------------------- |
| `GET /auth/token?role=admin` | Generate demo JWT (unsigned)        |
| `GET /auth/me`               | Decodes Bearer JWT → `request.user` |

### Books (`AppGraphQLModule` → GraphQL)

Requires `FEATURE_GRAPHQL=true` (default). The endpoint is `POST /graphql`.

| Operation                                         | Description              |
| ------------------------------------------------- | ------------------------ |
| `query { books { ... } }`                         | List all in-memory books |
| `query { book(id: "1") { ... } }`                 | Get a book by ID         |
| `mutation { createBook(input: { ... }) { ... } }` | Create a new book        |

The Apollo Sandbox playground is available at `GET /graphql`.

## Testing each collector

### TypeORM / MikroORM — Database tab

The DB is pre-seeded at startup. The same endpoints work whichever ORM `SQL_ORM` selects (the
controller/service are ORM-agnostic):

```bash
# default (SQL_ORM=typeorm), or run with SQL_ORM=mikro-orm pnpm example:dev
curl http://localhost:3000/products
curl http://localhost:3000/products/1
curl -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Widget","price":9.99}'
```

→ **Database** tab: SQL queries with type badge, duration bar, slow query highlighting — rendered
identically for both ORMs (shared `AbstractSqlQueryCollector`).

### Axios + Cache — HTTP Client and Cache tabs

```bash
# MISS + axios call + SET
curl http://localhost:3000/posts

# HIT — no axios call
curl http://localhost:3000/posts

# Reset
curl http://localhost:3000/posts/cache/clear
```

→ **HTTP Client** tab: GET https://… → 200 / duration.  
→ **Cache** tab: operations list + hit/miss ratio in toolbar badge.

### Mongoose — MongoDB tab

```bash
# List all reviews (Mongoose find)
curl http://localhost:3000/reviews

# Create a review
curl -X POST http://localhost:3000/reviews \
  -H "Content-Type: application/json" \
  -d '{"productId":"abc123","rating":4,"comment":"Great product!","author":"Alice"}'

# Aggregation pipeline — average rating per product
curl http://localhost:3000/reviews/stats
```

→ **MongoDB** tab: each query with its operation badge (`find`, `aggregate`, …), collection name, filter, duration, and result count. Queries exceeding `slowQueryThreshold` (50 ms) are highlighted in red.

### Auth — Security tab

```bash
TOKEN=$(curl -s "http://localhost:3000/auth/token?role=admin" | jq -r .token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/auth/me
```

→ **Security** tab: user object, roles, JWT claims. Badge shows username.

### Validator — Validator tab

```bash
# Valid DTO — shows "valid" capture
curl -X POST http://localhost:3000/posts \
  -H "Content-Type: application/json" \
  -d '{"title":"My post","body":"Body long enough to pass the MinLength(20) constraint."}'

# Invalid DTO — shows violations
curl -X POST http://localhost:3000/posts \
  -H "Content-Type: application/json" \
  -d '{"title":"Hi","body":"Too short"}'
```

→ **Validator** tab: `CreatePostDto` / valid|invalid / violation list with constraint names.

### GraphQL — Request tab (GQL badge)

```bash
# Named query
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{"operationName":"GetBooks","query":"query GetBooks { books { id title author publishedYear } }"}'

# Query with variable
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{"operationName":"GetBook","query":"query GetBook($id: ID!) { book(id: $id) { id title author } }","variables":{"id":"1"}}'

# Mutation
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{"operationName":"CreateBook","query":"mutation CreateBook($title: String!, $author: String!) { createBook(input: { title: $title, author: $author }) { id title } }","variables":{"title":"NestJS in Action","author":"John Doe"}}'
```

→ Profiles list: **GQL QUERY** / **GQL MUTATION** badge with operation name.  
→ **Request** tab: dedicated **GraphQL** section with operation type, name, syntax-highlighted query and variables.  
→ **Timeline** tab: `books.findAll`, `books.findOne`, or `books.create` spans from the resolver.

### Timeline — Timeline tab

```bash
curl http://localhost:3000/slow
```

→ **Timeline** tab: bar chart with `slow.step.fetch`, `slow.step.process`, `slow.step.serialize`, `slow.total`.

### Config — Config tab

Any request → **Config** tab shows `app.*` and `database.*` keys from `registerAs` factories. `database.password` is masked.

## Log capture in `main.ts`

The profiler's log collector is **logger-agnostic**: `profilerService.createLogger()` wraps any `LoggerService`, so the same capture works whether the app uses NestJS's built-in `ConsoleLogger` or a third-party logger such as `nestjs-pino`. `FEATURE_PINO_LOGGER` toggles which one is used — no profiler code changes.

```ts title="main.ts"
const app = await NestFactory.create(AppModule, { bufferLogs: true });
const profilerService = app.get(ProfilerService);

const baseLogger = isPinoLoggerEnabled(process.env)
  ? app.get(PinoLogger) // nestjs-pino
  : new ConsoleLogger('ExampleApi'); // NestJS default

app.useLogger(profilerService.createLogger(baseLogger));
await app.listen(port);
```

Try it both ways and compare the console output — the `/_profiler` **Logs** tab captures the same entries regardless:

```bash
# default ConsoleLogger
FEATURE_TYPEORM=false FEATURE_MONGOOSE=false pnpm example:dev
# third-party nestjs-pino (JSON, request-bound)
FEATURE_PINO_LOGGER=true FEATURE_TYPEORM=false FEATURE_MONGOOSE=false pnpm example:dev
```

### Capturing a directly-injected logger

`app.useLogger()` only captures logs that flow through NestJS's `Logger`. `PostsService` shows the other case: it injects `nestjs-pino`'s `PinoLogger` directly and wraps it with `profiler.createLogger(pinoLogger)`, so even pino's own `info()` is captured. Run in pino mode, call `GET /posts/cache/clear`, and check the **Logs** tab.

### Structured log context

The capture understands the common argument conventions, so the **Logs** tab shows the message, the context name and the payload as a JSON block:

```ts
// NestJS style — trailing context name (appended by `new Logger(MyService.name)`)
this.logger.log('Health check');

// message-first payload — ReviewsService
this.logger.log('Fetching reviews for product', { productId });

// pino object-first — PostsService (the injected PinoLogger also provides
// its `@InjectPinoLogger(...)` context name automatically)
this.logger?.info({ postCount, authorCount, cacheKey }, 'Resolved authors, caching enriched posts');
```

Call `GET /reviews/product/1` (message-first) or `GET /posts` (pino object-first) and compare the entries in the **Logs** tab.

Open `http://localhost:3000/_profiler` to browse all profiles.
