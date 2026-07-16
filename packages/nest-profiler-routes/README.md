# @eleven-labs/nest-profiler-routes

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
  <a href="https://codecov.io/gh/eleven-labs/nest-profiler/flags"><img alt="Coverage" src="https://codecov.io/gh/eleven-labs/nest-profiler/branch/main/graph/badge.svg?flag=nest-profiler-routes" /></a>
  <a href="https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-routes"><img alt="Documentation" src="https://img.shields.io/badge/docs-nest--profiler.eleven--labs.com-e5225a" /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a" />
  <img alt="Built with NestJS" src="https://img.shields.io/badge/built%20with-NestJS-ea2845" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Code style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" />
</p>

`@eleven-labs/nest-profiler-routes` adds a **Routes** panel to the profiler home page — a Symfony-Routing-style view of the application's routing table. Every registered route is listed with its HTTP method, full path and controller/handler; a lock marks routes protected by a guard. Expanding a route reveals its guards, path params, query params, request headers, and the body DTO (class name, decorated properties, TypeScript types and, when `class-validator` is installed, the validation rules).

![Routes view — the application routing table grouped by transport (REST, GraphQL, RabbitMQ, Commands), with per-route inputs, body DTOs and a lock on guarded routes](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/routes.png)

## Installation

```bash
pnpm add @eleven-labs/nest-profiler-routes@alpha
```

> There is no stable release yet — install every `@eleven-labs/nest-profiler*` package with the `@alpha` dist-tag (`@latest` resolves to nothing).

**Peer dependencies:** `@eleven-labs/nest-profiler`. `class-validator` is an **optional** peer — install it to surface DTO properties and validation rules; without it, a body DTO shows only its class name.

## Setup

```ts title="app.module.ts"
import { ConditionalModule } from '@nestjs/config';
import { RoutesCollectorModule } from '@eleven-labs/nest-profiler-routes';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] === 'true';

@Module({
  imports: [ConditionalModule.registerWhen(RoutesCollectorModule.forRoot(), isProfilerEnabled)],
})
export class AppModule {}
```

> **Enabling / disabling** — gate the collector with `ConditionalModule.registerWhen(..., isProfilerEnabled)` so it loads only when the profiler is on, or pass `RoutesCollectorModule.forRoot({ enabled: false })`. Wire the core `ProfilerModule` **once at the root** (add its `ProfilerNoopModule` fallback only if you inject `ProfilerService` directly) — see the [example app](https://nest-profiler.eleven-labs.com/docs/example-api).

## What it collects

At application startup, the panel discovers every registered route and groups it by transport. The core ships a built-in **REST** source; other transport packages contribute their own group — GraphQL resolvers (`@eleven-labs/nest-profiler-graphql`), RabbitMQ subscribers (`@eleven-labs/nest-profiler-rabbitmq`) and CLI commands (`@eleven-labs/nest-profiler-commander`) — by registering a `ProfilerRouteSource` with the core, so they appear automatically when installed.

Each REST route is introspected from its decorator metadata:

- **Guards** — the guard classes from `@UseGuards()` on the controller and/or handler (e.g. an authentication guard); guarded routes show a lock. Only route-level guards are visible — a global `APP_GUARD` is not attached per handler.
- **Path params** — from the route path (`/users/:id` → `id`).
- **Query params** — from `@Query('name')` and whole-object `@Query()` DTOs.
- **Headers** — from `@Headers('name')`.
- **Body DTO** — from `@Body()`: the DTO class name, its top-level decorated properties with their TypeScript types, and (with `class-validator`) the validation rules per property.

Introspection is top-level only: a property that is itself a DTO surfaces as its class name rather than being expanded.

## Contributing a custom route source

Any package can add its own group to the panel by registering a `ProfilerRouteSource` with the core (mirroring how entrypoint types are registered):

```ts
import { ModuleRef } from '@nestjs/core';
import { ProfilerCoreService } from '@eleven-labs/nest-profiler';
import type { ProfilerRouteSource } from '@eleven-labs/nest-profiler';

// in a module lifecycle hook:
const core = this.moduleRef.get(ProfilerCoreService, { strict: false });
core.registerRouteSource(mySource satisfies ProfilerRouteSource);
```

## License

MIT © [Eleven Labs](https://eleven-labs.com)
