# example-api

The `examples/api` directory contains a feature-complete NestJS application demonstrating every built-in collector. The application is organized into **one feature module per collector package**, making each collector's setup self-contained and easy to follow.

## Live demo

A live instance is deployed with the following configuration — no database infrastructure, in-memory storage only:

```
FEATURE_TYPEORM=false       # ProductsModule and PostgreSQL disabled
FEATURE_MONGOOSE=false      # ReviewsModule and MongoDB disabled
PROFILER_ENABLED=true
PROFILER_STORAGE_TYPE=memory
```

Active collectors on the live demo: **Posts** (Axios + Cache), **Auth**, **Config**, **Validator**, **GraphQL** (Books).

| Endpoint                 | URL                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| Swagger UI               | [nest-profiler-example.vercel.app/api](https://nest-profiler-example.vercel.app/api)              |
| Apollo Sandbox (GraphQL) | [nest-profiler-example.vercel.app/graphql](https://nest-profiler-example.vercel.app/graphql)      |
| Profiler UI              | [nest-profiler-example.vercel.app/\_profiler](https://nest-profiler-example.vercel.app/_profiler) |

## Prerequisites

- Node.js 22+, pnpm 10+
- Docker (optional — only needed when `FEATURE_TYPEORM` or `FEATURE_MONGOOSE` is enabled)

## Start the infrastructure

A `docker-compose.yml` is provided at the **project root**:

```bash
docker compose up -d
```

This starts **PostgreSQL 16** on port `5432` for the TypeORM collector demo, and **MongoDB 7** on port `27017` for the Mongoose collector demo.

## Feature flags

The example app uses feature flags to conditionally load infrastructure-dependent modules. Set them in `.env`:

| Variable              | Default | Description                                                         |
| --------------------- | ------- | ------------------------------------------------------------------- |
| `FEATURE_TYPEORM`     | `true`  | Load TypeORM + PostgreSQL connection + `ProductsModule`             |
| `FEATURE_MONGOOSE`    | `true`  | Load Mongoose + MongoDB connection + `ReviewsModule`                |
| `FEATURE_GRAPHQL`     | `true`  | Load GraphQL + Apollo Server + `BooksModule`                        |
| `FEATURE_PINO_LOGGER` | `false` | Use the third-party `nestjs-pino` logger instead of `ConsoleLogger` |
| `PROFILER_ENABLED`    | `true`  | Enable the profiler UI and all collectors                           |

Set any flag to `false` to disable the corresponding module. Modules that depend on disabled infrastructure are simply not registered — no connection is attempted, no crash.

```bash
# Run without any database (Posts, Auth, Config, Validator, GraphQL collectors still active)
FEATURE_TYPEORM=false FEATURE_MONGOOSE=false pnpm example:dev

# Run without GraphQL
FEATURE_GRAPHQL=false pnpm example:dev
```

## Run the application

```bash
pnpm example:dev
```

The API starts on port `3000`. Copy `.env.example` to `.env` to customise the database connection.  
Profiles are persisted to `.profiler/` (file storage) — they survive restarts.

## Swagger UI

Open **[http://localhost:3000/api](http://localhost:3000/api)** to access the interactive Swagger UI. Every endpoint is documented with its parameters, request body, and expected responses.

### Testing authenticated endpoints

The `/auth/me` endpoint requires a Bearer JWT. The built-in `/auth/token` shortcut generates a demo token in one click:

1. Call **`GET /auth/token`** — pick a role (`user`, `admin`, `moderator`) and execute.
2. Copy the `token` value from the response.
3. Click **Authorize** (top right), paste the token, and confirm.
4. Call **`GET /auth/me`** — the JWT is sent automatically.

> **Note:** The authorization is persisted across page reloads (`persistAuthorization: true`), so you only need to set it once per session.

### Swagger + profiler

Every request sent through Swagger UI generates a full profiler profile. After executing any call, copy the `X-Debug-Token` response header value and open `/_profiler/{token}` to inspect the collected data — SQL queries, cache operations, validation results, and more.

## Apollo Sandbox

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

Each feature module owns the collector(s) it demonstrates:

```
AppModule
├── DatabaseModule [FEATURE_TYPEORM]
│   └── ProductsModule  → TypeOrmCollectorModule (nest-profiler-typeorm)
├── MongoModule [FEATURE_MONGOOSE]
│   └── ReviewsModule   → MongooseCollectorModule (nest-profiler-mongoose)
├── AppGraphQLModule [FEATURE_GRAPHQL]
│   └── BooksModule     → ProfilerGraphQLModule (nest-profiler-graphql) + Apollo Server
├── PostsModule     → AxiosCollectorModule + CacheCollectorModule
│                     uses global ValidatorCollectorModule (POST /posts)
├── AuthModule      → AuthCollectorModule (nest-profiler-auth)
├── ConfigCollectorModule  (nest-profiler-config, global)
└── ValidatorCollectorModule (nest-profiler-validator, global APP_PIPE)
```

### AppModule — global infrastructure

`DatabaseModule` and `MongoModule` are wrapper modules loaded conditionally via `ConditionalModule.registerWhen`. Each encapsulates the database connection setup and the feature module that depends on it.

```ts title="app.module.ts"
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, mongodbConfig, appConfig, featuresConfig],
    }),
    ConditionalModule.registerWhen(DatabaseModule, isTypeOrmEnabled), // FEATURE_TYPEORM !== 'false'
    ConditionalModule.registerWhen(MongoModule, isMongooseEnabled), // FEATURE_MONGOOSE !== 'false'
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

### ProductsModule — demonstrates `nest-profiler-typeorm`

```ts title="products/products.module.ts"
@Module({
  imports: [
    TypeOrmModule.forFeature([Product]),
    TypeOrmCollectorModule.forRoot({ slowQueryThreshold: 50 }),
  ],
})
export class ProductsModule {}
```

### PostsModule — demonstrates `nest-profiler-axios` + `nest-profiler-cache` + `nest-profiler-validator`

```ts title="posts/posts.module.ts"
@Module({
  imports: [
    HttpModule, // prerequisite for AxiosCollectorModule
    AxiosCollectorModule.forRoot(),
    CacheCollectorModule.forRoot(),
  ],
  controllers: [PostsController],
})
export class PostsModule {}
```

`PostsController` exposes both `GET /posts` (Axios + Cache) and `POST /posts` (Validator). The global `ProfilerValidationPipe` registered by `ValidatorCollectorModule` intercepts `CreatePostDto` automatically.

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

### Products (`ProductsModule` → TypeORM)

The database is seeded automatically at startup — no manual step required. The seed clears the table and inserts 4 products on every restart.

| Endpoint               | Description                           |
| ---------------------- | ------------------------------------- |
| `GET /products`        | List all products (SELECT + ORDER BY) |
| `GET /products/:id`    | Get by ID (SELECT + WHERE)            |
| `POST /products`       | Create product                        |
| `DELETE /products/:id` | Delete product (SELECT + DELETE)      |

### Posts (`PostsModule` → Axios + Cache + Validator)

| Endpoint                 | Description                                                              |
| ------------------------ | ------------------------------------------------------------------------ |
| `GET /posts`             | First call: GET_MISS + axios → SET. Subsequent: GET_HIT                  |
| `POST /posts`            | Create with `CreatePostDto` — captures valid/invalid via Validator panel |
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

### TypeORM — Database tab

The DB is pre-seeded at startup. Run queries directly:

```bash
curl http://localhost:3000/products
curl http://localhost:3000/products/1
curl -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Widget","price":9.99}'
```

→ **Database** tab: SQL queries with type badge, duration bar, slow query highlighting.

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

`app.useLogger()` only captures logs that flow through NestJS's `Logger`. `PostsController` shows the other case: it injects `nestjs-pino`'s `PinoLogger` directly and wraps it with `profiler.createLogger(pinoLogger)`, so even pino's own `info()` is captured. Run in pino mode, call `GET /posts/cache/clear`, and check the **Logs** tab.

Open `http://localhost:3000/_profiler` to browse all profiles.
