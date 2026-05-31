# @eleven-labs/nest-profiler-mongoose

`@eleven-labs/nest-profiler-mongoose` captures every Mongoose query and aggregation executed during an HTTP request and displays them in a dedicated **MongoDB** panel.

## Installation

```bash
pnpm add @eleven-labs/nest-profiler-mongoose
```

**Peer dependencies:** `mongoose ^8.0.0`, `@nestjs/mongoose ^11.0.0`

## Setup

```ts title="reviews.module.ts"
import { MongooseModule } from '@nestjs/mongoose';
import { MongooseCollectorModule } from '@eleven-labs/nest-profiler-mongoose';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Review.name, schema: ReviewSchema }]),
    MongooseCollectorModule.forRoot({
      slowQueryThreshold: 100, // ms — queries above this are highlighted (default: 100)
    }),
  ],
})
export class ReviewsModule {}
```

`MongooseModule.forRoot()` (or `forRootAsync`) must be registered in `AppModule` before using `MongooseCollectorModule`.

## What it collects

For each Mongoose query or aggregation executed during a request:

| Field        | Description                                    |
| ------------ | ---------------------------------------------- |
| `collection` | MongoDB collection name (e.g. `reviews`)       |
| `operation`  | Mongoose operation (e.g. `find`, `aggregate`)  |
| `filter`     | Query filter object (if applicable)            |
| `duration`   | Execution time in ms                           |
| `isSlow`     | `true` if duration ≥ `slowQueryThreshold`      |
| `startedAt`  | Unix timestamp                                 |
| `count`      | Number of results returned (find queries only) |
| `error`      | Error message if the query failed              |

Slow queries are highlighted in red in the panel.

## Toolbar badge

The toolbar badge shows: `{n}q` (e.g., `4q`). When slow queries are present: `4q (1 slow)`.

## How it works

At module initialization, the collector patches `mongoose.Query.prototype.exec` and `mongoose.Aggregate.prototype.exec` on the Mongoose instance retrieved from `connection.base`. This captures all queries regardless of when schemas were registered, and is fully transparent — Mongoose behavior is unchanged.
