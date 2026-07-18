# `ProfilerModuleOptions` reference

Passed to `ProfilerModule.forRoot(options)` or returned from the `useFactory` of `forRootAsync` (except `isGlobal` and `enabled`, which stay top-level and synchronous).

Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration> · reference: <https://nest-profiler.eleven-labs.com/docs/api-reference/nest-profiler>

| Option             | Type                      | Default     | Notes                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`          | `boolean`                 | `true`      | Synchronous bootstrap decision. When `false`, only the inert no-op layer registers. The library default is `true`, but this skill always gates on `enabled('PROFILER_ENABLED')` (default off), so the effective behaviour is **off unless `PROFILER_ENABLED=true`**. Prefer `ConditionalModule` (Approach A); use this flag only without `@nestjs/config`. |
| `isGlobal`         | `boolean`                 | `false`     | Register as a global NestJS module. If you also register `ProfilerNoopModule` (only needed when the app injects `ProfilerService` directly), keep `isGlobal` identical on it.                                                                                                                                                                              |
| `security`         | `ProfilerSecurityOptions` | —           | Pluggable access control for the UI/API (`authorize` predicate and/or NestJS `guards`, plus `linkQuery`). **Omitted ⇒ the profiler is open** (local dev only). See "Securing the UI" below.                                                                                                                                                                |
| `maxProfiles`      | `number`                  | `100`       | Max profiles kept (LRU eviction). `0`/negative = no cap.                                                                                                                                                                                                                                                                                                   |
| `ttl`              | `number`                  | `3600`      | Profile TTL in seconds. `0`/negative = never expire.                                                                                                                                                                                                                                                                                                       |
| `storageType`      | `'memory' \| 'file'`      | `'memory'`  | Built-in storage backend. Use `'file'` for CLI/multi-process (commander). For SQLite, pass a `storage` adapter (below) instead.                                                                                                                                                                                                                            |
| `storagePath`      | `string`                  | `.profiler` | Directory for file storage, resolved from `process.cwd()`. Add it to `.gitignore`.                                                                                                                                                                                                                                                                         |
| `storage`          | `IProfilerStorageAdapter` | —           | Custom adapter (SQLite, Redis, DB…); takes precedence over `storageType`. See the storage section.                                                                                                                                                                                                                                                         |
| `collectBody`      | `boolean`                 | `false`     | Capture request/response bodies. Sensitive — leave off unless you accept the exposure (see production section).                                                                                                                                                                                                                                            |
| `collectorTimeout` | `number`                  | `1000`      | Max ms a collector may run before being abandoned. `0`/negative disables the timeout.                                                                                                                                                                                                                                                                      |
| `lifecycleSpans`   | `boolean`                 | `true`      | Assemble the flat request-lifecycle band (`guards`, `validation`, `controller`) shown above the Timeline waterfall. `validation` is filled by `@eleven-labs/nest-profiler-validator` when installed. Set `false` to skip the band entirely.                                                                                                                |
| `sampleRate`       | `number`                  | `1.0`       | Fraction of requests profiled (0.0–1.0).                                                                                                                                                                                                                                                                                                                   |
| `maskCookies`      | `string[]`                | —           | Cookie names whose value is replaced with `'***'`.                                                                                                                                                                                                                                                                                                         |
| `maskHeaders`      | `string[]`                | see notes   | Request headers (case-insensitive) replaced with `[REDACTED]`. Merged with the built-ins: `authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `proxy-authorization`.                                                                                                                                                                     |

`enabled` and `isGlobal` are synchronous: decided at module-build time, never inside `forRootAsync`'s `useFactory`.

**Less common** (rarely set during initial setup) — `listPageSize`, `maxBodySize`, `ignorePaths` / `useDefaultIgnorePaths`, `emitDebugHeaders`, `ignoreRequest`, and `performance.rules`. They exist; reach for the full table in the [configuration docs](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration) when you need one. (`ignorePaths` / `ignoreRequest` and `performance.rules` still come up in the production and performance sections below and in the `interpret-performance-tags` skill.)

## Storage backends

Three options, in precedence order:

1. **`storage`** (custom adapter) — wins over everything. Use for SQLite / Redis / a DB.
2. **`storageType: 'file'`** — JSON profiles under `storagePath` (default `.profiler`). Survives restarts; required for CLI + web sharing (commander).
3. **`storageType: 'memory'`** (default) — fastest, lost on restart.

### SQLite

The core never imports `@libsql/client`. Opt in by passing the adapter from the `/sqlite` subpath (optional peer dependency `@libsql/client`, install it alongside). One adapter serves a local file, `:memory:`, or a remote SQLite database:

```ts
import { SqliteStorageAdapter } from '@eleven-labs/nest-profiler/sqlite';

ProfilerModule.forRootAsync({
  isGlobal: true,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    storage: new SqliteStorageAdapter(
      // A remote SQLite URL takes precedence over the local file path.
      config.get<string>('profiler.storageUrl')
        ? {
            url: config.get<string>('profiler.storageUrl'),
            authToken: config.get<string>('profiler.storageAuthToken'),
            maxProfiles: config.get<number>('profiler.maxProfiles'),
            ttl: config.get<number>('profiler.ttl'),
          }
        : {
            path: config.get<string>('profiler.storagePath') ?? '.profiler/profiler.db',
            maxProfiles: config.get<number>('profiler.maxProfiles'),
            ttl: config.get<number>('profiler.ttl'),
          },
    ),
  }),
});
```

Add the storage path (`.profiler/`) to `.gitignore` for both `file` and a local `sqlite` (a remote `url` needs no local file). The repo's `examples/api/src/profiling/profiling.module.ts` shows a `resolveStorageOptions(config)` helper that switches between the three from config.

## Environment variables

- `PROFILER_ENABLED` — read by the `isProfilerEnabled` predicate (`enabled('PROFILER_ENABLED')`, see `enable-strategies.md`). **Off by default; set `=true` to turn on** (dev only).
- The profiler itself reads **no** authentication env var — access control is code (the `security` option). Any credential var (e.g. `PROFILER_TOKEN`, `PROFILER_BASIC_PASSWORD`) is defined and read by **your own** `security` strategy, not by the profiler. The `examples/api` app drives its demo strategies from `PROFILER_AUTH` + those vars.
- Optional, when you drive options from `ConfigService`: `PROFILER_STORAGE_TYPE`, `PROFILER_STORAGE_PATH`, `PROFILER_TTL`, `PROFILER_MAX_PROFILES`.

## Response headers (every profiled response, unless `emitDebugHeaders: false`)

- `X-Debug-Token` — the profile token.
- `X-Debug-Token-Link` — path to the profile detail view (`/_profiler/<token>`).

## Securing the UI (`security`)

The profiler ships **open** — no authentication by default (local dev). There is **no built-in token option any more**; you bring the authentication and the profiler enforces it via the `security` option. Static assets under `__assets/*` stay exempt so the UI can load. Three building blocks, usable alone or together — **when several are provided, all must pass**:

- **`authorize`** — a predicate `(ctx) => boolean | Promise<boolean>`. `ctx.request` / `ctx.response` are the platform-agnostic Express/Fastify surfaces (read cookies, headers, session, query). Return `false` to deny (the guard throws `401`). Set a `WWW-Authenticate` header on `ctx.response` before denying to trigger a browser Basic-auth prompt.
- **`guards`** — one or more NestJS `CanActivate` guards (a class resolved through DI so you can **reuse an existing app guard** like `JwtAuthGuard`, or a ready instance). The guard's dependencies must be resolvable from the profiler module's context. Use `forRootAsync` when the decision needs injected services.
- **`linkQuery`** — `(request) => string` returning a query string (e.g. `?token=abc`) appended to every UI link so a **query-param** credential survives browser navigation. Not needed for cookie/session/Basic auth (the browser propagates those on its own); needed for `?token=` schemes.

Browser caveat: the UI is navigated via plain `<a>` links, which only carry what the browser attaches automatically (cookies, sessions, Basic auth). A bare `Authorization: Bearer` header or `?token=` cannot ride a link click — header schemes suit API/CLI clients (`curl`), query schemes need `linkQuery`.

```ts title="reuse an existing NestJS guard (browser-navigable via cookie/Bearer)"
ProfilerModule.forRoot({ isGlobal: true, security: { guards: [JwtAuthGuard] } });
```

```ts title="HTTP Basic (browser prompts, re-sends on every link)"
security: {
  authorize: ({ request, response }) => {
    const ok = request.headers['authorization'] === `Basic ${expectedBase64}`;
    if (!ok) response.setHeader('WWW-Authenticate', 'Basic realm="Profiler"');
    return ok;
  },
}
```

```ts title="bearer token or ?token= (needs linkQuery for browser)"
security: {
  authorize: ({ request }) => tokenOf(request) === expected, // Bearer header or ?token=
  linkQuery: (request) => (request.query?.token ? `?token=${request.query.token}` : ''),
}
```

New exports: `ProfilerSecurityOptions`, `ProfilerAuthorize`, `ProfilerAuthContext`, `ProfilerGuard`, `PlatformRequest`, `PlatformResponse`. The `examples/api` `resolveProfilerSecurity` wires Basic / token / cookie side by side, selected by `PROFILER_AUTH`. Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#securing-the-ui>

## If you enable it in production (not recommended by default)

Keep the profiler **off in production by default** — the default `enabled('PROFILER_ENABLED')` (unset ⇒ off) already does this. Enabling it in production is a legitimate choice when the API is **not publicly reachable** (internal, behind a VPN) or the user has accepted the exposure — don't refuse it, help them do it with eyes open. The `harden-for-production` skill automates this checklist:

- **Require access control** — the profiler is **open by default**, so in production you MUST provide a `security` strategy (an `authorize` predicate and/or NestJS `guards`; all provided must pass). See "Securing the UI" above. This is the actual access control; the `path` value is not security.
- **Don't capture bodies** — leave `collectBody: false` (or a small `maxBodySize`), and add only the `maskCookies` / `maskHeaders` / per-collector masks you need.
- **Sample and cap** — lower `sampleRate` to profile a fraction of traffic, and keep `maxProfiles` / `ttl` small so retention stays bounded.
- **Skip sensitive routes** — use `ignorePaths` / `ignoreRequest` for auth, payment or PII endpoints.
- **Mind persistence** — with `file` / `sqlite` storage, profiles land on disk under `storagePath`; make sure that path is not web-served and is cleaned up.
