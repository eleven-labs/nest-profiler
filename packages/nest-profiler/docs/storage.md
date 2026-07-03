Profiles have to live somewhere between the request that produces them and the moment you open the UI. Three options are available, controlled by the `storageType` or `storage` options.

## Memory (default)

Profiles are kept in an in-memory LRU map and are **lost on restart**.

```ts
ProfilerModule.forRoot({
  storageType: 'memory', // default — no need to specify
  maxProfiles: 100,
  ttl: 3600,
});
```

## File system

Profiles are stored as individual JSON files and **survive restarts**. Inspired by Symfony's file profiler.

```ts
ProfilerModule.forRoot({
  storageType: 'file',
  storagePath: '.profiler', // relative to cwd, default: '.profiler'
  maxProfiles: 200,
  ttl: 86400, // 24h
});
```

Each profile is written to `{storagePath}/{token}.json`. The directory is created automatically. Add `.profiler/` to `.gitignore`.

The file adapter keeps an in-memory index of each profile's queryable summary (type, method, status, duration, exceptions, a search haystack and kind-specific attributes), persisted alongside the profiles in a `{storagePath}/_index.meta` sidecar. A list render filters, sorts and paginates over this index and then reads **only the current page's** `{token}.json` files — never the whole store. The index is rebuilt from the profile files if the sidecar is missing, and reconciled with the directory on every read, so profiles written by another process (e.g. a CLI command) appear without a restart and externally removed files drop out.

For fast repeated reads, parsed profiles are also cached in memory and validated against each file's mtime, so steady-state memory grows with `maxProfiles × average profile size` — keep `maxProfiles` reasonable when `collectBody` is enabled. Profiles returned by the storage are shared with this cache: treat them as read-only.

## Custom adapter

Implement `IProfilerStorageAdapter` to plug in any backend (Redis, database, …):

```ts
import type {
  IProfilerStorageAdapter,
  StorageFindOptions,
  Profile,
} from '@eleven-labs/nest-profiler';

export class RedisStorageAdapter implements IProfilerStorageAdapter {
  async save(profile: Profile): Promise<void> {
    /* ... */
  }
  async findAll(options?: StorageFindOptions): Promise<Profile[]> {
    /* ... */
  }
  async findOne(token: string): Promise<Profile | undefined> {
    /* ... */
  }
  async clear(): Promise<void> {
    /* ... */
  }
}

ProfilerModule.forRoot({
  storage: new RedisStorageAdapter(redisClient), // takes precedence over storageType
});
```

The four methods above are all an adapter must implement — the profiler filters and paginates in memory by fetching everything through `findAll`. For a large backing store you can **push that work down** by additionally implementing the optional `query(query: ProfilerQuery): ProfilerPage` (filters + sort + pagination, returning a page plus the total count) and `distinct(field, typeIn?)` (values for a dynamic filter's `select`). Implement `setIndexAttributesProvider(provider)` too if you index kind-specific attributes (a GraphQL `operationType`, a RabbitMQ `exchange`…) so those filters push down as well. The helpers `selectPage`, `distinctFromSummaries` and `summarizeProfile` are exported to build a `ProfileSummary`-backed index; when these methods are absent the profiler transparently falls back to the in-memory path.

> **Step-by-step tutorial** — [File-based profile storage](https://nest-profiler.eleven-labs.com/docs/tutorials/file-storage) shows persistent profiles in action, including CLI command profiles that survive the process that created them.
