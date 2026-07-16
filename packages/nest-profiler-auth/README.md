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
pnpm add @eleven-labs/nest-profiler-auth@alpha
```

> There is no stable release yet — install every `@eleven-labs/nest-profiler*` package with the `@alpha` dist-tag (`@latest` resolves to nothing).

No additional peer dependencies beyond `nestjs-cls` (already required by `@eleven-labs/nest-profiler`).

## Setup

```ts title="auth.module.ts"
import { ConditionalModule } from '@nestjs/config';
import { AuthCollectorModule } from '@eleven-labs/nest-profiler-auth';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] === 'true';

@Module({
  imports: [
    ConditionalModule.registerWhen(
      AuthCollectorModule.forRoot({ maskUserFields: ['password', 'refreshToken'] }),
      isProfilerEnabled,
    ),
  ],
})
export class AppModule {}
```

> **Enabling / disabling** — gate the collector with `ConditionalModule.registerWhen(..., isProfilerEnabled)` as shown, so it loads only when `PROFILER_ENABLED` is on. Wire the core `ProfilerModule` and its `ProfilerNoopModule` fallback **once at the root** — the recommended setup bundles the root-level profiler modules into a single `ProfilingModule` behind two `ConditionalModule` gates (see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#enabling-and-disabling-the-profiler) and the [example app](https://nest-profiler.eleven-labs.com/docs/example-api)). A top-level `enabled` option is also supported as an alternative.

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

The authenticated user's identifier (`username`, `email`, `sub`, or `id`) or `anon` for unauthenticated requests.

## How it works

The collector reads `request.user` and the `Authorization` header from the current CLS context (set by the profiler middleware). It decodes the JWT payload using `Buffer.from(payload, 'base64url')` without any cryptographic verification.

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
