# @eleven-labs/nest-profiler

`@eleven-labs/nest-profiler` provides execution profiling for NestJS applications. Each profiled execution receives a unique token, and the collected data (request, response, performance, logs, exceptions, custom collectors) can be inspected at `/_profiler/{token}`.

![Profiler UI — profiles list with filters, HTTP statuses, durations and global panels](../../docs/public/screenshots/profiler/profiles-list.png)

## Installation

```bash
pnpm add @eleven-labs/nest-profiler nestjs-cls
```

`nestjs-cls` is a required peer dependency used for per-execution context propagation.

## Configuration

```ts title="app.module.ts"
import { Module } from '@nestjs/common';
import { ProfilerModule } from '@eleven-labs/nest-profiler';

@Module({
  imports: [
    ProfilerModule.forRoot({
      isGlobal: true,
      // The host app owns the decision — packages never read process.env.
      enabled: process.env.NODE_ENV !== 'production',
      maxProfiles: 100,
    }),
  ],
})
export class AppModule {}
```

## Async configuration

`enabled` is a **synchronous, top-level** bootstrap flag — it is not resolved by `useFactory` (it must be known before the async factory runs, so the active layer can be skipped at module-build time). Keep it outside the factory:

```ts title="app.module.ts"
ProfilerModule.forRootAsync({
  enabled: process.env.NODE_ENV !== 'production',
  useFactory: (config: ConfigService) => ({
    maxProfiles: config.get('PROFILER_MAX_PROFILES', 100),
  }),
  inject: [ConfigService],
});
```

## Enable log capture

Wrap any existing logger with `profilerService.createLogger()` so that every log entry is captured in the active request profile:

```ts title="main.ts"
import { ConsoleLogger } from '@nestjs/common';

const app = await NestFactory.create(AppModule, { bufferLogs: true });

const profilerService = app.get(ProfilerService);

app.useLogger(profilerService.createLogger(new ConsoleLogger('MyApplication')));
```

## Debug headers

Every non-profiler request receives response headers:

| Header               | Value                              |
| -------------------- | ---------------------------------- |
| `X-Debug-Token`      | The request token (UUID v4)  |
| `X-Debug-Token-Link` | Link to `/_profiler/{token}` |

## Profiler UI endpoints

| Endpoint                     | Description                    |
| ---------------------------- | ------------------------------ |
| `GET /_profiler`             | List of recent profiles (HTML) |
| `GET /_profiler/:token`      | Profile detail page (HTML)     |
| `GET /_profiler/:token/data` | Raw profile data (JSON)        |

### List filters

The profile list supports server-side filtering via query parameters:

```
GET /_profiler?method=GET&minDuration=100&url=/api
```

| Parameter     | Description                |
| ------------- | -------------------------- |
| `method`      | HTTP method (GET, POST, …) |
| `statusCode`  | Response status code       |
| `minDuration` | Minimum duration in ms     |
| `maxDuration` | Maximum duration in ms     |
| `url`         | URL contains this string   |

### Export a profile

Every profile detail page has an **Export JSON** button. You can also download the raw profile directly:

```bash
curl http://localhost:3000/_profiler/{token}/data > profile.json
```

## Securing the UI

Set the `PROFILER_TOKEN` environment variable to protect `/_profiler/*` with a Bearer token:

```bash
PROFILER_TOKEN=your-secret-token
```

Then access the profiler with:

```bash
curl -H "Authorization: Bearer your-secret-token" http://localhost:3000/_profiler
```

When `PROFILER_TOKEN` is not set, the profiler UI is publicly accessible (suitable for local development).

## Timeline spans

Instrument any code with `startSpan()` to capture custom timing data in the **Timeline** panel:

```ts
import { ProfilerService } from '@eleven-labs/nest-profiler';

@Injectable()
export class UserService {
  constructor(private readonly profiler: ProfilerService) {}

  async findAll() {
    const stop = this.profiler.startSpan('db.findAll');
    const users = await this.userRepository.find();
    stop();
    return users;
  }
}
```

The built-in **Timeline collector** is always active and displays all spans as a visual bar chart.

## Custom collectors

Annotate a provider with `@ProfilerCollector()` to automatically add a custom data panel to every profile. The collector is auto-discovered via NestJS `DiscoveryModule` — no manual registration required.

```ts
import { Injectable } from '@nestjs/common';
import { ProfilerCollector, IProfilerCollector, Profile } from '@eleven-labs/nest-profiler';
import * as path from 'path';

const MY_ICON = `<svg viewBox="0 0 16 16" fill="currentColor">...</svg>`;

@Injectable()
@ProfilerCollector({
  name: 'myCollector',
  label: 'My Collector',
  icon: MY_ICON,
  priority: 50,
})
export class MyCollector implements IProfilerCollector {
  readonly name = 'myCollector';
  readonly label = 'My Collector';
  readonly icon = MY_ICON;
  readonly priority = 50;

  getBadgeValue(profile: Profile): string | null {
    // Return a value to display as a badge in the toolbar
    return '42';
  }

  getTemplatePath(): string {
    // Optional: path to a custom EJS panel template
    return path.join(__dirname, 'templates', 'my-collector-panel.ejs');
  }

  collect(profile: Profile): unknown {
    // Return any serializable data for this panel
    return { items: [] };
  }
}
```

Register the collector as a provider in your module — the profiler discovers it automatically at startup.

### Custom EJS panel template

When `getTemplatePath()` is defined, the profiler renders your custom EJS template instead of the default JSON dump. The template receives:

| Variable       | Type                       | Description                   |
| -------------- | -------------------------- | ----------------------------- |
| `data`         | `unknown`                  | Value returned by `collect()` |
| `profile`      | `Profile`                  | The full request profile      |
| `panel`        | `CollectorPanelInfo`       | Panel metadata (name, label…) |
| `highlightSql` | `(sql: string) => string`  | SQL syntax highlighter        |
| `toJson`       | `(val: unknown) => string` | JSON formatter                |
| `isoDate`      | `(ts: number) => string`   | ISO date formatter            |
| `timeOnly`     | `(ts: number) => string`   | Time-only formatter           |

## Storage backends

Three options are available, controlled by `storageType` or `storage`.

### Memory (default)

Profiles are kept in an in-memory LRU map and are **lost on restart**.

```ts
ProfilerModule.forRoot({
  storageType: 'memory', // default — no need to specify
  maxProfiles: 100,
  ttl: 3600,
});
```

### File system

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

### Custom adapter

Implement `IProfilerStorageAdapter` to plug in any backend (Redis, database, …):

```ts
import type { IProfilerStorageAdapter, StorageFindOptions, Profile } from '@eleven-labs/nest-profiler';

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

## Public API

```ts
import {
  ProfilerModule,
  ProfilerService,
  ProfilerStorageService,
  ProfilerViewsSetup,
  CollectorRegistry,
  ProfilerCollector,
  TimelineCollector,
  PROFILER_STORAGE_ADAPTER,
  MemoryStorageAdapter,
  FileStorageAdapter,
} from '@eleven-labs/nest-profiler';

import type {
  ProfilerModuleOptions,
  ProfilerModuleAsyncOptions,
  IProfilerCollector,
  IProfilerStorageAdapter,
  StorageFindOptions,
  CollectorPanelInfo,
  Profile,
  LogEntry,
  ExceptionEntry,
  TimelineSpan,
  EventEntry,
  SecurityContext,
} from '@eleven-labs/nest-profiler';
```

## Options

| Option           | Type                      | Default      | Description                                           |
| ---------------- | ------------------------- | ------------ | ----------------------------------------------------- |
| `enabled`        | `boolean`                 | `true`       | Enable or disable the profiler.                       |
| `path`           | `string`                  | `/_profiler` | Base path for the profiler UI.                        |
| `maxProfiles`    | `number`                  | `100`        | Maximum profiles kept (LRU eviction).                 |
| `ttl`            | `number`                  | `3600`       | Profile time-to-live in seconds.                      |
| `isGlobal`       | `boolean`                 | `false`      | Register the module as a global NestJS module.        |
| `storageType`    | `'memory' \| 'file'`      | `'memory'`   | Built-in storage backend.                             |
| `storagePath`    | `string`                  | `.profiler`  | Directory for file storage (relative or absolute).    |
| `storage`        | `IProfilerStorageAdapter` | —            | Custom adapter — takes precedence over `storageType`. |
| `collectBody`    | `boolean`                 | `false`      | Capture request/response bodies (use with caution).   |
| `sampleRate`     | `number`                  | `1.0`        | Fraction of requests to profile (0.0–1.0).            |
| `ignorePaths`    | `(string \| RegExp)[]`    | `[]`         | Paths to skip profiling (prefix string or RegExp).    |
