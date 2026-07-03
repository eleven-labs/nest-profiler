# `ProfilerModuleOptions` reference

Passed to `ProfilerModule.forRoot(options)` or returned from the `useFactory` of `forRootAsync` (except `isGlobal` and `enabled`, which stay top-level and synchronous).

| Option                  | Type                      | Default      | Notes                                                                                                                                                                |
| ----------------------- | ------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`               | `boolean`                 | `true`       | Synchronous bootstrap decision. When `false`, only the inert no-op layer registers. Prefer `ConditionalModule` (Approach A); use this only without `@nestjs/config`. |
| `isGlobal`              | `boolean`                 | `false`      | Register as a global NestJS module. Keep it identical on the paired `ProfilerNoopModule`.                                                                            |
| `path`                  | `string`                  | `/_profiler` | Base path of the profiler UI.                                                                                                                                        |
| `token`                 | `string`                  | —            | Bearer token to access the UI. Falls back to the `PROFILER_TOKEN` env var. If neither is set, the UI is open (dev only).                                             |
| `maxProfiles`           | `number`                  | `100`        | Max profiles kept (LRU eviction).                                                                                                                                    |
| `ttl`                   | `number`                  | `3600`       | Profile TTL in seconds.                                                                                                                                              |
| `storageType`           | `'memory' \| 'file'`      | `'memory'`   | Built-in storage backend. Use `'file'` for CLI/multi-process (commander).                                                                                            |
| `storagePath`           | `string`                  | `.profiler`  | Directory for file storage, resolved from `process.cwd()`. Add it to `.gitignore`.                                                                                   |
| `storage`               | `IProfilerStorageAdapter` | —            | Custom adapter; takes precedence over `storageType`.                                                                                                                 |
| `collectBody`           | `boolean`                 | `false`      | Capture request/response bodies. Sensitive — leave off unless you accept the exposure (see production section).                                                      |
| `collectorTimeout`      | `number`                  | `1000`       | Max ms a collector may run before being abandoned. `0`/negative disables the timeout.                                                                                |
| `sampleRate`            | `number`                  | `1.0`        | Fraction of requests profiled (0.0–1.0).                                                                                                                             |
| `ignorePaths`           | `(string \| RegExp)[]`    | `[]`         | Paths to skip (prefix string or RegExp), merged after defaults.                                                                                                      |
| `useDefaultIgnorePaths` | `boolean`                 | `true`       | Skip noisy browser/tooling requests (favicon, robots.txt, Chrome DevTools probe, apple-touch-icon).                                                                  |
| `maskCookies`           | `string[]`                | —            | Cookie names whose value is replaced with `'***'`.                                                                                                                   |
| `ignoreRequest`         | `ProfilerRequestFilter`   | —            | Custom predicate run after `ignorePaths`; return `true` to skip. Compose with `combineFilters(...)` (e.g. the GraphQL ignore filters).                               |

## Environment variables

- `PROFILER_ENABLED` — read by the `isProfilerEnabled` predicate in Approach A (`!== 'false'` ⇒ on).
- `PROFILER_TOKEN` — fallback for the `token` option; when set, `/_profiler/*` requires `Authorization: Bearer <token>`.

## Response headers (every profiled response)

- `X-Debug-Token` — the profile token.
- `X-Debug-Token-Link` — path to the profile detail view (`/_profiler/<token>`).

## If you enable it in production (not recommended by default)

Recommend keeping the profiler off in production. But it is a legitimate choice when the API is **not publicly reachable** (internal, behind a VPN) or the user has accepted the exposure — don't refuse it, help them do it with eyes open. Hardening checklist:

- **Require a token** — set `PROFILER_TOKEN` (or the `token` option) so `/_profiler/*` needs `Authorization: Bearer <token>`. This is the actual access control; the `path` value is not security.
- **Don't capture bodies** — leave `collectBody: false`, and add only the `maskCookies` / `maskHeaders` (per collector) you need.
- **Sample and cap** — lower `sampleRate` to profile a fraction of traffic, and keep `maxProfiles` / `ttl` small so retention stays bounded.
- **Skip sensitive routes** — use `ignorePaths` / `ignoreRequest` for auth, payment or PII endpoints.
- **Mind persistence** — with `storageType: 'file'`, profiles land on disk under `storagePath`; make sure that path is not web-served and is cleaned up.
