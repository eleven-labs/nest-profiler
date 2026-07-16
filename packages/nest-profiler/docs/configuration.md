`ProfilerModule` is configured once, in the root module of the application. This page covers the synchronous and asynchronous registration styles, the full options reference, and how to protect the profiler UI with a pluggable security strategy.

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

> **CLI apps (`nest-commander`):** `ConditionalModule.registerWhen` `await`s `ConfigModule.envVariablesLoaded` from `@nestjs/config`, which only resolves once `ConfigModule.forRoot()` has run. An HTTP app's root module usually imports it already, but a CLI bootstrapped with `CommandFactory` may not — and without it, registration hangs and the process exits `0` **silently** (no logs, no error, since the internal timeout is `unref`'d). If you use this gating in a CLI, import `ConfigModule.forRoot()` in its root module. See [Command profiling](https://nest-profiler.eleven-labs.com/docs/tutorials/commander-collector) and the [troubleshooting guide](https://nest-profiler.eleven-labs.com/docs/troubleshooting).

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

Note `enabled` is a **synchronous, top-level** bootstrap flag — with `forRootAsync` it is not resolved by `useFactory` (it must be known before the async factory runs), so it stays outside the factory. The same holds for every **collector** (`-http`, `-typeorm`, `-config`, …): their `forRootAsync` resolves option _values_ only, never `enabled`. So to set `enabled` **together with** options in a single call, use `forRoot({ enabled, ...options })`; to drive options from `ConfigService` while toggling per environment — the **recommended** approach — gate `forRootAsync` with `ConditionalModule.registerWhen(...)` instead. This is the only place in the docs that details the `enabled` option; prefer `ConditionalModule` everywhere else.

## Options

| Option                  | Type                         | Default     | Description                                                                                                                                                                                                                                       |
| ----------------------- | ---------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`               | `boolean`                    | `true`      | Enable or disable the profiler.                                                                                                                                                                                                                   |
| `security`              | `ProfilerSecurityOptions`    | —           | Pluggable access control for the UI/API (`authorize` predicate and/or NestJS `guards`, plus `linkQuery`). When omitted the profiler is open (local dev only). See [Securing the UI](#securing-the-ui).                                            |
| `maxProfiles`           | `number`                     | `100`       | Maximum profiles kept (LRU eviction). `0` or negative: no cap.                                                                                                                                                                                    |
| `listPageSize`          | `number`                     | `25`        | Profiles shown per page in each dashboard list section (HTTP, GraphQL, RabbitMQ, Commands…). Each section paginates independently.                                                                                                                |
| `ttl`                   | `number`                     | `3600`      | Profile time-to-live in seconds. `0` or negative: never expire.                                                                                                                                                                                   |
| `isGlobal`              | `boolean`                    | `false`     | Register the module as a global NestJS module.                                                                                                                                                                                                    |
| `storageType`           | `'memory' \| 'file'`         | `'memory'`  | Built-in storage backend.                                                                                                                                                                                                                         |
| `storagePath`           | `string`                     | `.profiler` | Directory for file storage (relative or absolute).                                                                                                                                                                                                |
| `storage`               | `IProfilerStorageAdapter`    | —           | Custom adapter — takes precedence over `storageType`.                                                                                                                                                                                             |
| `collectBody`           | `boolean`                    | `false`     | Capture request/response bodies (use with caution).                                                                                                                                                                                               |
| `maxBodySize`           | `number`                     | `65536`     | Max serialized size (chars) of a captured body before it is truncated to a placeholder. `0` disables truncation.                                                                                                                                  |
| `maskCookies`           | `string[]`                   | `[]`        | Cookie names whose value is replaced with `[REDACTED]` in the captured request.                                                                                                                                                                   |
| `maskHeaders`           | `string[]`                   | sensitive   | Request header names whose value is replaced with `[REDACTED]` at capture. Defaults to `authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `proxy-authorization`.                                                               |
| `emitDebugHeaders`      | `boolean`                    | `true`      | Emit the `X-Debug-Token` / `X-Debug-Token-Link` response headers on profiled responses. Turn off in shared/staging environments.                                                                                                                  |
| `collectorTimeout`      | `number`                     | `1000`      | Max ms a single collector may run before it is abandoned (`0` disables).                                                                                                                                                                          |
| `sampleRate`            | `number`                     | `1.0`       | Fraction of requests to profile (0.0–1.0).                                                                                                                                                                                                        |
| `ignorePaths`           | `(string \| RegExp)[]`       | `[]`        | Paths to skip profiling (prefix string or RegExp), merged after the defaults.                                                                                                                                                                     |
| `useDefaultIgnorePaths` | `boolean`                    | `true`      | Skip noisy browser/tooling requests by default (favicon, robots.txt, the Chrome DevTools `/.well-known/appspecific/com.chrome.devtools.json` probe, apple-touch-icon).                                                                            |
| `ignoreRequest`         | `ProfilerRequestFilter`      | —           | Custom predicate; return `true` to skip profiling. Applied together with `ignorePaths` (either one matching skips the request). Compose several conditions with `combineFilters`.                                                                 |
| `error`                 | `ProfilerErrorOptions`       | 5xx         | What counts as a **failed HTTP request** — what earns the `error` tag and what the list's `Errors` filter keeps. Default: a 5xx status, so 4xx like `401`/`404` are answers, not errors. See [What counts as an error](#what-counts-as-an-error). |
| `performance`           | `ProfilerPerformanceOptions` | —           | Custom rules for the tagging engine. See [Performance tags](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/performance-tags).                                                                                                  |

The storage-related options (`storageType`, `storagePath`, `storage`, `maxProfiles`, `ttl`) are detailed on the [Storage backends](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/storage) page.

## What counts as an error

`error` defines what a **failed request** is for the built-in `http` kind. By default that is a 5xx status, or a captured exception when no status was recorded — a `401`/`403`/`404` means your application answered correctly, so it is not an error:

```ts
ProfilerModule.forRoot({ error: { httpStatus: 400 } }); // count 4xx too
```

This governs the `http` kind only. Every other entrypoint kind carries its own definition, configured on its own package (`GraphQLCollectorModule`, `RabbitMqCollectorModule`), since a status code means nothing to them — and outgoing HTTP calls are judged separately via `HttpCollectorModule`. The full picture, including the `Exception` filter and custom kinds, is on the [What counts as an error](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/error-classification) page.

## Versioning and global prefix

The profiler is tooling, not part of your API surface, so **your app's routing never applies to it**. The UI is always at `/_profiler`, and you have nothing to declare for that to hold.

**API versioning** is ignored — the controller is `VERSION_NEUTRAL`, so no scheme (URI, header or media-type) prefixes it:

```ts
app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
// your routes  -> /v1/orders
// the profiler -> /_profiler
```

A **global prefix** is ignored too. The profiler opts itself out of `setGlobalPrefix()`, so it stays at the root while your own routes get prefixed as usual:

```ts
app.setGlobalPrefix('api/v1');
// your routes  -> /api/v1/orders
// the profiler -> /_profiler
```

Listing `_profiler` in `exclude` yourself is therefore unnecessary — though harmless if you do, the profiler will not add a second entry.

> **Watch out:** `exclude` does more than skip the prefix — it also determines which routes the profiler's middleware binds to. A route served outside Nest's router (a GraphQL endpoint handled by Apollo, say) must be listed there, otherwise the middleware never runs for it and its operations drop out of the profiler:
>
> ```ts
> app.setGlobalPrefix('api/v1', {
>   exclude: [{ path: 'graphql', method: RequestMethod.ALL }],
> });
> ```

## Securing the UI

The profiler ships **open** — no authentication by default (intended for local development). To lock `/_profiler/*` down, provide your own strategy through the `security` option. You bring the authentication; the profiler just enforces it. Two building blocks, usable alone or together (when both are set, **all must pass**):

- `authorize` — a predicate `(ctx) => boolean | Promise<boolean>` deciding access. `ctx.request` and `ctx.response` are the platform-agnostic Express/Fastify surfaces. Return `false` to deny (the guard throws `401`).
- `guards` — one or more NestJS `CanActivate` guards (a class resolved through DI, so you can reuse an existing app guard, or a ready instance).

Static assets under `/_profiler/__assets/*` are always exempt so the UI's CSS/JS load even behind auth.

### Token (bearer, for API/CLI clients)

```ts title="app.module.ts"
ProfilerModule.forRoot({
  security: {
    authorize: ({ request }) =>
      request.headers['authorization'] === `Bearer ${process.env.PROFILER_TOKEN}`,
  },
});
```

```bash
curl -H "Authorization: Bearer your-secret-token" http://localhost:3000/_profiler
```

### Basic auth (browser challenge)

Set a `WWW-Authenticate` header before denying so the browser prompts for credentials:

```ts
security: {
  authorize: ({ request, response }) => {
    const header = request.headers['authorization'] ?? '';
    const [user, pass] = Buffer.from(header.replace('Basic ', ''), 'base64').toString().split(':');
    if (user === 'admin' && pass === process.env.PROFILER_PASSWORD) return true;
    response.setHeader('WWW-Authenticate', 'Basic realm="Profiler"');
    return false;
  },
}
```

### Cookie / session

The browser sends cookies and sessions automatically on every request, so this works across all UI navigation with nothing else to wire:

```ts
security: {
  authorize: ({ request }) => Boolean(request.session?.isAdmin),
}
```

### Reuse a NestJS guard (with DI)

Resolve services through `forRootAsync`, or hand the profiler an existing guard class:

```ts
ProfilerModule.forRoot({ security: { guards: [JwtAuthGuard, AdminGuard] } });

// or inject services into the decision:
ProfilerModule.forRootAsync({
  inject: [AuthService],
  useFactory: (auth: AuthService) => ({
    security: { authorize: ({ request }) => auth.isProfilerAdmin(request) },
  }),
});
```

### Browser navigation & `linkQuery`

The UI is navigated through plain `<a>` links. A browser only attaches the credentials it holds itself — **cookies, sessions and HTTP Basic auth** — so those schemes propagate to every page (including the `/:token/data` JSON export) with no extra work. A bare `Authorization` header or a `?token=` query cannot ride a link click: header auth therefore suits API/CLI clients (curl), while a query-param scheme needs `linkQuery` to thread the credential through the UI's links:

```ts
security: {
  authorize: ({ request }) => request.query?.token === process.env.PROFILER_TOKEN,
  linkQuery: (request) => (request.query?.token ? `?token=${request.query.token}` : ''),
}
```

### See it in action

The [example app's `resolveProfilerSecurity`](https://github.com/eleven-labs/nest-profiler/blob/main/examples/api/src/profiling/profiling.module.ts) wires every seam side by side, selected by a `PROFILER_AUTH` env var (`basic`, `token`, `cookie`) exactly like its `SQL_ORM` adapter switch — off by default. `cookie` reuses a NestJS guard through `security.guards` and reads the JWT from a cookie, so it stays browser-navigable while also accepting a Bearer header for API clients.
