# @eleven-labs/nest-profiler-cache

`@eleven-labs/nest-profiler-cache` intercepts `@nestjs/cache-manager` operations (GET HIT, GET MISS, SET, DEL) during HTTP requests and displays them in a **Cache** panel with hit/miss statistics.

## Installation

```bash
pnpm add @eleven-labs/nest-profiler-cache @nestjs/cache-manager
```

**Peer dependencies:** `@nestjs/cache-manager ^3.0.0`

## Setup

```ts title="app.module.ts"
import { CacheModule } from '@nestjs/cache-manager';
import { CacheCollectorModule } from '@eleven-labs/nest-profiler-cache';

@Module({
  imports: [
    CacheModule.register({ isGlobal: true }),
    CacheCollectorModule.forRoot(),
    ProfilerModule.forRoot({ isGlobal: true }),
  ],
})
export class AppModule {}
```

## What it collects

For each cache operation:

| Field       | Description                            |
| ----------- | -------------------------------------- |
| `operation` | `GET_HIT`, `GET_MISS`, `SET`, or `DEL` |
| `key`       | Cache key                              |
| `duration`  | Operation duration in ms               |
| `startedAt` | Unix timestamp                         |

The panel also displays an aggregated hit/miss ratio.

## Toolbar badge

`{hits}H/{misses}M` (e.g., `8H/2M`). When no GET operations: `{n}ops`.

## How it works

At module initialization, the collector wraps the `CACHE_MANAGER`'s `get`, `set`, and `del` methods using a JavaScript `Proxy`. Each wrapped call records the operation type, key, and duration into the current request profile.
