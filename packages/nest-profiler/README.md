# @eleven-labs/nest-profiler

<p align="center">
  <a href="https://eleven-labs.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/assets/eleven-labs-white.svg">
      <img alt="Powered &amp; maintained by Eleven Labs" src="https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/assets/eleven-labs-dark.svg" width="180">
    </picture>
  </a>
</p>

<p align="center"><em>Powered &amp; maintained by <a href="https://eleven-labs.com">Eleven Labs</a></em></p>

<p align="center">
  <a href="https://github.com/eleven-labs/nest-profiler/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/eleven-labs/nest-profiler/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/eleven-labs/nest-profiler/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/eleven-labs/nest-profiler/actions/workflows/quality.yml/badge.svg" /></a>
  <a href="https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler"><img alt="Documentation" src="https://img.shields.io/badge/docs-nest--profiler.eleven--labs.com-e5225a" /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a" />
  <img alt="Built with NestJS" src="https://img.shields.io/badge/built%20with-NestJS-ea2845" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Code style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" />
</p>

`@eleven-labs/nest-profiler` provides execution profiling for NestJS applications. Each profiled execution receives a unique token, and the collected data (request, response, performance, logs, exceptions, custom collectors) can be inspected at `/_profiler/{token}`.

![Profiler UI — profiles list with filters, HTTP statuses, durations and global panels](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/profiles-list.png)

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

Wrap any existing logger with `profilerService.createLogger()` so that every log entry is captured in the active request profile. The wrapper is a transparent proxy: it returns the **same type** as the logger you pass in, captures its level methods, and forwards everything else — so it is **logger-agnostic** and works with NestJS's `ConsoleLogger`, `nestjs-pino`, `nest-winston`, etc.

```ts title="main.ts"
import { ConsoleLogger } from '@nestjs/common';

const app = await NestFactory.create(AppModule, { bufferLogs: true });

const profilerService = app.get(ProfilerService);

app.useLogger(profilerService.createLogger(new ConsoleLogger('MyApplication')));
```

### Capturing a directly-injected logger

`app.useLogger()` only routes logs that go through NestJS's `Logger`. A logger **injected directly** (e.g. `nestjs-pino`'s `PinoLogger`) bypasses it — wrap that instance too:

```ts
constructor(
  profiler: ProfilerService,
  @InjectPinoLogger(MyService.name) pinoLogger: PinoLogger,
) {
  // pino's own `info()` keeps working AND is now captured into the profile
  this.logger = profiler.createLogger(pinoLogger);
}
```

The default mapping already knows the common third-party method names (pino's `info` → `log`, `trace` → `verbose`, …). For an exotic logger, pass a custom map:

```ts
import { DEFAULT_LOG_METHODS } from '@eleven-labs/nest-profiler';

profiler.createLogger(myLogger, { ...DEFAULT_LOG_METHODS, silly: 'verbose' });
```

## Debug headers

Every non-profiler request receives response headers:

| Header               | Value                        |
| -------------------- | ---------------------------- |
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

## Custom protocol adapters

The `IContextAdapter` interface lets you profile any non-HTTP protocol (gRPC, Kafka, WebSockets…) without modifying the core. Implement the interface, register it with the `PROFILER_CONTEXT_ADAPTERS` multi-token, and `ProfilerInterceptor` will delegate that context type to your adapter automatically.

```ts
import { Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { PROFILER_CONTEXT_ADAPTERS, PROFILER_REQ_KEY } from '@eleven-labs/nest-profiler';
import type { IContextAdapter, Profile } from '@eleven-labs/nest-profiler';

@Injectable()
export class GrpcContextAdapter implements IContextAdapter {
  readonly contextType = 'rpc';

  recoverProfile(ctx: ExecutionContext): Profile | null {
    const [metadata] = ctx.getArgs();
    return ((metadata as Record<symbol, unknown>)?.[PROFILER_REQ_KEY] as Profile) ?? null;
  }

  enrichProfile(profile: Profile, _ctx: ExecutionContext): void {
    // add protocol-specific data to profile.request
  }
}

// Register in a dedicated module:
@Module({
  providers: [
    GrpcContextAdapter,
    { provide: PROFILER_CONTEXT_ADAPTERS, useExisting: GrpcContextAdapter, multi: true },
  ],
})
export class GrpcProfilerModule {}
```

`@eleven-labs/nest-profiler-graphql` is the reference implementation of this pattern for GraphQL (Apollo, Mercurius, graphql-yoga).

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

| Option             | Type                      | Default      | Description                                                              |
| ------------------ | ------------------------- | ------------ | ------------------------------------------------------------------------ |
| `enabled`          | `boolean`                 | `true`       | Enable or disable the profiler.                                          |
| `path`             | `string`                  | `/_profiler` | Base path for the profiler UI.                                           |
| `maxProfiles`      | `number`                  | `100`        | Maximum profiles kept (LRU eviction).                                    |
| `ttl`              | `number`                  | `3600`       | Profile time-to-live in seconds.                                         |
| `isGlobal`         | `boolean`                 | `false`      | Register the module as a global NestJS module.                           |
| `storageType`      | `'memory' \| 'file'`      | `'memory'`   | Built-in storage backend.                                                |
| `storagePath`      | `string`                  | `.profiler`  | Directory for file storage (relative or absolute).                       |
| `storage`          | `IProfilerStorageAdapter` | —            | Custom adapter — takes precedence over `storageType`.                    |
| `collectBody`      | `boolean`                 | `false`      | Capture request/response bodies (use with caution).                      |
| `collectorTimeout` | `number`                  | `1000`       | Max ms a single collector may run before it is abandoned (`0` disables). |
| `sampleRate`       | `number`                  | `1.0`        | Fraction of requests to profile (0.0–1.0).                               |
| `ignorePaths`      | `(string \| RegExp)[]`    | `[]`         | Paths to skip profiling (prefix string or RegExp).                       |

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
