# Config & Auth collectors

Two independent root-level collectors that snapshot sensitive-by-nature data (resolved config, the authenticated user) with built-in masking you can extend.

---

## Config — `@eleven-labs/nest-profiler-config`

Snapshots the resolved configuration at bootstrap into a panel, with secret auto-masking.

- **Peers (required):** `@nestjs/config@^4`. **Does not** peer on `nestjs-cls`.
- **Module:** `ConfigCollectorModule` (`forRoot` + `forRootAsync`).
- **Placement:** the composition root, **after** `ConfigModule`. Bundle into `ProfilingModule`.
- **Behaviour:** snapshots via `configService.internalConfig`; auto-masks keys matching `password|secret|key|token|credential|api_key`. `maskKeys` adds extra key names or fully-qualified paths (e.g. `database.password`).
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-config> · tutorial: <https://nest-profiler.eleven-labs.com/docs/tutorials/config-collector>

| Option     | Type       | Default | Notes                                                           |
| ---------- | ---------- | ------- | --------------------------------------------------------------- |
| `enabled`  | `boolean`  | `true`  | Synchronous.                                                    |
| `maskKeys` | `string[]` | `[]`    | Extra key names / dotted paths to mask (merged with built-ins). |

**Key question to ask:** any extra config keys/paths to mask beyond the built-in secret detection?

```ts
import { ConfigCollectorModule } from '@eleven-labs/nest-profiler-config';

ConditionalModule.registerWhen(
  ConfigCollectorModule.forRoot({ maskKeys: ['database.password'] }),
  isProfilerEnabled,
),
```

---

## Auth — `@eleven-labs/nest-profiler-auth`

Shows the authenticated user and decoded JWT for each request in an Auth panel.

- **Peers (required):** `nestjs-cls@^6`. **No** auth-library peer — it is dependency-free (heuristic detection via `@nestjs/passport` / `@nestjs/jwt`).
- **Module:** `AuthCollectorModule` (`forRoot` + `forRootAsync`).
- **Placement:** the auth or app module.
- **Behaviour:** reads `request.user` and the `Authorization` header from CLS and **decodes the JWT without verifying it** (display only). Built-in mask covers `password|secret|key|token|credential`; `maskUserFields` adds more.
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-auth> · tutorial: <https://nest-profiler.eleven-labs.com/docs/tutorials/auth-collector>

| Option           | Type       | Default | Notes                                                        |
| ---------------- | ---------- | ------- | ------------------------------------------------------------ |
| `enabled`        | `boolean`  | `true`  | Synchronous.                                                 |
| `maskUserFields` | `string[]` | `[]`    | Extra `request.user` fields to mask (merged with built-ins). |

**Key question to ask:** any extra user fields to mask (e.g. `refreshToken`)?

```ts
import { AuthCollectorModule } from '@eleven-labs/nest-profiler-auth';

ConditionalModule.registerWhen(
  AuthCollectorModule.forRoot({ maskUserFields: ['password', 'refreshToken'] }),
  isProfilerEnabled,
),
```
