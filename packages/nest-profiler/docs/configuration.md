`ProfilerModule` is configured once, in the root module of the application. This page covers the synchronous and asynchronous registration styles, the full options reference, and how to protect the profiler UI with a token.

## Module registration

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

Use `forRootAsync` when the options depend on injected providers such as `ConfigService`. One field is different: `enabled` is a **synchronous, top-level** bootstrap flag — it is not resolved by `useFactory` (it must be known before the async factory runs, so the active layer can be skipped at module-build time). Keep it outside the factory:

```ts title="app.module.ts"
ProfilerModule.forRootAsync({
  enabled: process.env.NODE_ENV !== 'production',
  useFactory: (config: ConfigService) => ({
    maxProfiles: config.get('PROFILER_MAX_PROFILES', 100),
  }),
  inject: [ConfigService],
});
```

## Options

| Option                  | Type                      | Default      | Description                                                                                                                                                            |
| ----------------------- | ------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`               | `boolean`                 | `true`       | Enable or disable the profiler.                                                                                                                                        |
| `path`                  | `string`                  | `/_profiler` | Base path for the profiler UI.                                                                                                                                         |
| `maxProfiles`           | `number`                  | `100`        | Maximum profiles kept (LRU eviction).                                                                                                                                  |
| `ttl`                   | `number`                  | `3600`       | Profile time-to-live in seconds.                                                                                                                                       |
| `isGlobal`              | `boolean`                 | `false`      | Register the module as a global NestJS module.                                                                                                                         |
| `storageType`           | `'memory' \| 'file'`      | `'memory'`   | Built-in storage backend.                                                                                                                                              |
| `storagePath`           | `string`                  | `.profiler`  | Directory for file storage (relative or absolute).                                                                                                                     |
| `storage`               | `IProfilerStorageAdapter` | —            | Custom adapter — takes precedence over `storageType`.                                                                                                                  |
| `collectBody`           | `boolean`                 | `false`      | Capture request/response bodies (use with caution).                                                                                                                    |
| `collectorTimeout`      | `number`                  | `1000`       | Max ms a single collector may run before it is abandoned (`0` disables).                                                                                               |
| `sampleRate`            | `number`                  | `1.0`        | Fraction of requests to profile (0.0–1.0).                                                                                                                             |
| `ignorePaths`           | `(string \| RegExp)[]`    | `[]`         | Paths to skip profiling (prefix string or RegExp), merged after the defaults.                                                                                          |
| `useDefaultIgnorePaths` | `boolean`                 | `true`       | Skip noisy browser/tooling requests by default (favicon, robots.txt, the Chrome DevTools `/.well-known/appspecific/com.chrome.devtools.json` probe, apple-touch-icon). |

The storage-related options (`storageType`, `storagePath`, `storage`, `maxProfiles`, `ttl`) are detailed on the [Storage backends](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/storage) page.

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
