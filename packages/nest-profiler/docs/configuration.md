`ProfilerModule` is configured once, in the root module of the application. This page covers the synchronous and asynchronous registration styles, the full options reference, and how to protect the profiler UI with a token.

## Module registration

```ts title="app.module.ts"
import { Module } from '@nestjs/common';
import { ProfilerModule } from '@eleven-labs/nest-profiler';

@Module({
  imports: [
    ProfilerModule.forRoot({
      isGlobal: true,
      maxProfiles: 100,
    }),
  ],
})
export class AppModule {}
```

The profiler is a development tool — see [Enabling and disabling the profiler](#enabling-and-disabling-the-profiler) below for the recommended way to turn it off in production.

## Async configuration

Use `forRootAsync` when the options depend on injected providers such as `ConfigService`:

```ts title="app.module.ts"
ProfilerModule.forRootAsync({
  useFactory: (config: ConfigService) => ({
    maxProfiles: config.get('PROFILER_MAX_PROFILES', 100),
  }),
  inject: [ConfigService],
});
```

## Enabling and disabling the profiler

The profiler is a development tool — turn it off in production. There are two ways to do it; both keep `ProfilerService` injectable so the code that depends on it (custom spans, the wrapped logger…) never breaks when profiling is off.

### Recommended: `ConditionalModule` + `ProfilerNoopModule`

Gate the active `ProfilerModule` with Nest's `ConditionalModule.registerWhen`, and register `ProfilerNoopModule` as the fallback. When profiling is off, the active module — with its middleware, interceptor, storage and collectors — is never loaded; `ProfilerNoopModule` provides a **zero-dependency** no-op `ProfilerService` in its place (no CLS store, and the async options factory never runs), so the disabled path costs nothing.

```ts title="app.module.ts"
import { ProfilerModule, ProfilerNoopModule } from '@eleven-labs/nest-profiler';
import { ConditionalModule } from '@nestjs/config';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] === 'true';

@Module({
  imports: [
    ConditionalModule.registerWhen(
      ProfilerModule.forRootAsync({ isGlobal: true, useFactory: () => ({ maxProfiles: 100 }) }),
      isProfilerEnabled,
    ),
    ConditionalModule.registerWhen(
      ProfilerNoopModule.forRoot({ isGlobal: true }),
      (env) => !isProfilerEnabled(env),
    ),
  ],
})
export class AppModule {}
```

The condition is a plain `(env) => boolean`; register `ProfilerNoopModule.forRoot({ isGlobal: true })` with the same `isGlobal` as the active module so `ProfilerService` stays visible to every feature module. Gate each optional collector package (`@eleven-labs/nest-profiler-http`, `-config`, …) the same way — they need no no-op counterpart, as they self-register through discovery.

#### Keep the root tidy: bundle into a `ProfilingModule`

When several profiler modules live at the composition root (the core plus root-level collectors such as config, validator or commander), group them into a single module so the root keeps just **two** gates — one for the active bundle, one for the no-op fallback:

```ts title="profiling.module.ts"
import { DynamicModule, Module } from '@nestjs/common';
import { ProfilerModule } from '@eleven-labs/nest-profiler';
import { ConfigCollectorModule } from '@eleven-labs/nest-profiler-config';
import { ValidatorCollectorModule } from '@eleven-labs/nest-profiler-validator';

@Module({})
export class ProfilingModule {
  static forRoot(): DynamicModule {
    return {
      module: ProfilingModule,
      imports: [
        ProfilerModule.forRoot({ isGlobal: true }),
        ConfigCollectorModule.forRoot(),
        ValidatorCollectorModule.forRoot(),
      ],
    };
  }
}
```

```ts title="app.module.ts"
@Module({
  imports: [
    ConditionalModule.registerWhen(ProfilingModule.forRoot(), isProfilerEnabled),
    ConditionalModule.registerWhen(
      ProfilerNoopModule.forRoot({ isGlobal: true }),
      (env) => !isProfilerEnabled(env),
    ),
  ],
})
export class AppModule {}
```

**Infra-scoped** collectors (database, HTTP client, cache, messaging, GraphQL transport…) stay co-located in the bounded-context module that owns their infrastructure, each gated with its own `ConditionalModule.registerWhen(...)` — they cannot join the bundle because they must sit next to the `HttpModule` / ORM / broker they instrument. The [example app](https://nest-profiler.eleven-labs.com/docs/example-api) demonstrates the full pattern.

### Alternative: the `enabled` option

Every profiler module also accepts a top-level `enabled` flag. When `false`, the core registers an **inert layer** that binds `ProfilerService` to the same no-op service (again, no CLS and no active layer):

```ts title="app.module.ts"
ProfilerModule.forRoot({ isGlobal: true, enabled: process.env.NODE_ENV !== 'production' }),
```

Note `enabled` is a **synchronous, top-level** bootstrap flag — with `forRootAsync` it is not resolved by `useFactory` (it must be known before the async factory runs), so it stays outside the factory. This is the only place in the docs that shows the `enabled` option; prefer `ConditionalModule` everywhere else.

## Options

| Option                  | Type                      | Default     | Description                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`               | `boolean`                 | `true`      | Enable or disable the profiler.                                                                                                                                                                                                                      |
| `token`                 | `string`                  | —           | Token required to access the profiler UI, as `Authorization: Bearer <token>` (API) or a `?token=` query parameter (browser). Static assets are exempt. Takes precedence over `PROFILER_TOKEN`; when neither is set, the UI is open (local dev only). |
| `maxProfiles`           | `number`                  | `100`       | Maximum profiles kept (LRU eviction). `0` or negative: no cap.                                                                                                                                                                                       |
| `listPageSize`          | `number`                  | `25`        | Profiles shown per page in each dashboard list section (HTTP, GraphQL, RabbitMQ, Commands…). Each section paginates independently.                                                                                                                   |
| `ttl`                   | `number`                  | `3600`      | Profile time-to-live in seconds. `0` or negative: never expire.                                                                                                                                                                                      |
| `isGlobal`              | `boolean`                 | `false`     | Register the module as a global NestJS module.                                                                                                                                                                                                       |
| `storageType`           | `'memory' \| 'file'`      | `'memory'`  | Built-in storage backend.                                                                                                                                                                                                                            |
| `storagePath`           | `string`                  | `.profiler` | Directory for file storage (relative or absolute).                                                                                                                                                                                                   |
| `storage`               | `IProfilerStorageAdapter` | —           | Custom adapter — takes precedence over `storageType`.                                                                                                                                                                                                |
| `collectBody`           | `boolean`                 | `false`     | Capture request/response bodies (use with caution).                                                                                                                                                                                                  |
| `maxBodySize`           | `number`                  | `65536`     | Max serialized size (chars) of a captured body before it is truncated to a placeholder. `0` disables truncation.                                                                                                                                     |
| `maskCookies`           | `string[]`                | `[]`        | Cookie names whose value is replaced with `[REDACTED]` in the captured request.                                                                                                                                                                      |
| `maskHeaders`           | `string[]`                | sensitive   | Request header names whose value is replaced with `[REDACTED]` at capture. Defaults to `authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `proxy-authorization`.                                                                  |
| `emitDebugHeaders`      | `boolean`                 | `true`      | Emit the `X-Debug-Token` / `X-Debug-Token-Link` response headers on profiled responses. Turn off in shared/staging environments.                                                                                                                     |
| `collectorTimeout`      | `number`                  | `1000`      | Max ms a single collector may run before it is abandoned (`0` disables).                                                                                                                                                                             |
| `sampleRate`            | `number`                  | `1.0`       | Fraction of requests to profile (0.0–1.0).                                                                                                                                                                                                           |
| `ignorePaths`           | `(string \| RegExp)[]`    | `[]`        | Paths to skip profiling (prefix string or RegExp), merged after the defaults.                                                                                                                                                                        |
| `useDefaultIgnorePaths` | `boolean`                 | `true`      | Skip noisy browser/tooling requests by default (favicon, robots.txt, the Chrome DevTools `/.well-known/appspecific/com.chrome.devtools.json` probe, apple-touch-icon).                                                                               |
| `ignoreRequest`         | `ProfilerRequestFilter`   | —           | Custom predicate; return `true` to skip profiling. Applied together with `ignorePaths` (either one matching skips the request). Compose several conditions with `combineFilters`.                                                                    |

The storage-related options (`storageType`, `storagePath`, `storage`, `maxProfiles`, `ttl`) are detailed on the [Storage backends](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/storage) page.

## Securing the UI

Protect `/_profiler/*` with a Bearer token in one of two ways. Both are equivalent; the `token` option takes precedence over the environment variable.

The `token` option, when the value comes from your config layer:

```ts title="app.module.ts"
ProfilerModule.forRoot({ token: process.env.PROFILER_TOKEN });
```

Or the `PROFILER_TOKEN` environment variable, read automatically when the `token` option is omitted:

```bash
PROFILER_TOKEN=your-secret-token
```

Then access the profiler with:

```bash
curl -H "Authorization: Bearer your-secret-token" http://localhost:3000/_profiler
```

When neither the `token` option nor `PROFILER_TOKEN` is set, the profiler UI is publicly accessible (suitable for local development only).
