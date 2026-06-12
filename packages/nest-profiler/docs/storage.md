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

The in-memory index is reconstructed from disk on startup — expired profiles are cleaned up automatically.

For fast list rendering, parsed profiles are also cached in memory and validated against each file's mtime, so steady-state memory grows with `maxProfiles × average profile size` — keep `maxProfiles` reasonable when `collectBody` is enabled. Profiles returned by the storage are shared with this cache: treat them as read-only.

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

> **Step-by-step tutorial** — [File-based profile storage](https://nest-profiler.eleven-labs.com/docs/tutorials/file-storage) shows persistent profiles in action, including CLI command profiles that survive the process that created them.
