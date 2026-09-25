# @eleven-labs/nest-profiler-auth

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
  <a href="https://codecov.io/gh/eleven-labs/nest-profiler/flags"><img alt="Coverage" src="https://codecov.io/gh/eleven-labs/nest-profiler/branch/main/graph/badge.svg?flag=nest-profiler-auth" /></a>
  <a href="https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-auth"><img alt="Documentation" src="https://img.shields.io/badge/docs-nest--profiler.eleven--labs.com-e5225a" /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a" />
  <img alt="Built with NestJS" src="https://img.shields.io/badge/built%20with-NestJS-ea2845" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Code style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" />
</p>

`@eleven-labs/nest-profiler-auth` captures the authentication context (Passport user, JWT claims, roles) of the current execution and displays it in a **Security** panel.

![Security panel — authenticated user, roles and decoded JWT claims with sensitive fields masked](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/security.png)

## Installation

```bash
pnpm add -D @eleven-labs/nest-profiler-auth
```

No additional peer dependencies beyond `nestjs-cls` (already required by `@eleven-labs/nest-profiler`).

## Setup

```ts title="profiling/profiling.module.ts"
import { Module } from '@nestjs/common';
import { ProfilerModule } from '@eleven-labs/nest-profiler';
import { AuthCollectorModule } from '@eleven-labs/nest-profiler-auth';

@Module({
  imports: [
    ProfilerModule.forRoot({ isGlobal: true }),
    AuthCollectorModule.forRoot({ maskUserFields: ['password', 'refreshToken'] }),
  ],
})
export class ProfilingModule {}
```

> `ProfilingModule` is the dev-only bundle loaded by `main-dev.ts` — see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#recommended-install-it-as-a-dev-dependency). If the profiler is installed as a production dependency behind the [runtime gate](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#when-production-code-calls-the-profiler-conditionalmodule), wrap the same call in `ConditionalModule.registerWhen(..., isProfilerEnabled)`.

Authentication itself stays in your application: the guard (Passport or your own) that sets `request.user` lives in your production modules, and the collector reads what it leaves on the request.

## What it collects

| Field             | Description                                              |
| ----------------- | -------------------------------------------------------- |
| `isAuthenticated` | `true` when `request.user` is populated (Passport)       |
| `user`            | The `request.user` object (with sensitive fields masked) |
| `roles`           | `user.roles` or `user.role` (normalized to array)        |
| `jwtClaims`       | Decoded JWT payload from `Authorization: Bearer …`       |

**Automatic masking:** Fields matching `password|secret|key|token|credential` are replaced with `***`. Additional fields can be specified via `maskUserFields`.

Note: The JWT is decoded **without verification** (display only). Never rely on this data for security decisions.

## Toolbar badge

Unauthenticated requests always show a compact `anon`. For **authenticated** requests, the badge content is configurable via the `badge` option (default: `'status'`), so a long email no longer wraps the sidebar row — the full identity stays in the panel detail:

| `badge`        | Authenticated badge                                              |
| -------------- | ---------------------------------------------------------------- |
| `'status'`     | A fixed, compact `auth` label (default) — mirrors `anon`.        |
| `'role'`       | The first role (`admin`, `user`, …), falling back to `auth`.     |
| `'identifier'` | Legacy behaviour: `username ?? email ?? sub ?? id`, else `auth`. |

```ts
AuthCollectorModule.forRoot({
  badge: 'role', // 'status' (default) | 'role' | 'identifier'
});
```

For full control, provide a `badgeValue` resolver — it takes precedence over `badge`, receives the collected `SecurityContext`, and may return `null` to hide the badge. It runs only for authenticated requests (unauthenticated stays `anon`):

```ts
AuthCollectorModule.forRoot({
  badgeValue: (security) => security.roles?.[0] ?? 'auth',
});
```

## How it works

The collector reads `request.user` and the `Authorization` header from the current CLS context (set by the profiler middleware). It decodes the JWT payload using `Buffer.from(payload, 'base64url')` without any cryptographic verification.

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
