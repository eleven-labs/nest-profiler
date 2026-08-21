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

`@eleven-labs/nest-profiler-routes` adds the **Discover** views to the profiler home page — a Symfony-Routing-style view of the application's routing table, with **one sidebar view per transport** (`Discover / HTTP`, `Discover / GraphQL`, `Discover / Commands`, `Discover / RabbitMQ`) so each transport's table is a subject of its own. Every registered route is listed with its HTTP method, full path and controller/handler; a lock marks routes protected by a guard. Expanding a route reveals its description, guards, path params, query params, request headers, and the body DTO (class name, decorated properties, TypeScript types and, when `class-validator` is installed, the validation rules). Non-HTTP sources describe their inputs with their own labels — CLI commands list **Arguments** and **Options** with each option's description, GraphQL fields list **Arguments**.

A transport that discovered nothing gets no view at all, so the sidebar only ever lists what the application actually registered.

![Discover / HTTP view — the application routing table with per-route inputs, body DTOs and a lock on guarded routes](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/discover.png)

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

At application startup, every registered route is discovered and grouped by transport, and each group becomes its own **Discover** view — keyed `discover-<transport>` in the `?view=` parameter, so it can never collide with the same-protocol profile list (`?view=graphql` stays the GraphQL list, `?view=discover-graphql` its routing table). The core ships a built-in **HTTP** source; other transport packages contribute their own — GraphQL resolvers (`@eleven-labs/nest-profiler-graphql`), RabbitMQ subscribers (`@eleven-labs/nest-profiler-rabbitmq`) and CLI commands (`@eleven-labs/nest-profiler-commander`) — by registering a `ProfilerRouteSource` with the core, so they appear automatically when installed.

Each REST route is introspected from its decorator metadata:

- **Guards** — the guard classes from `@UseGuards()` on the controller and/or handler (e.g. an authentication guard); guarded routes show a lock. Only route-level guards are visible — a global `APP_GUARD` is not attached per handler.
- **Path params** — from the route path (`/users/:id` → `id`).
- **Query params** — from `@Query('name')` and whole-object `@Query()` DTOs.
- **Headers** — from `@Headers('name')`.
- **Body DTO** — from `@Body()`: the DTO class name, its top-level decorated properties with their TypeScript types, and (with `class-validator`) the validation rules per property.

Introspection is top-level only: a property that is itself a DTO surfaces as its class name rather than being expanded.

Sources whose inputs are not HTTP-shaped use `RouteInputs.groups` instead — a list of `{ label, items }` sections, each item being a `{ name, description?, required?, defaultValue? }`. That is how the CLI source lists **Arguments** and **Options**, and the GraphQL source its field **Arguments**, without borrowing an HTTP label. A route may also carry a `description`, rendered above its inputs.

## Contributing a custom route source

Any package can add its own **Discover** view by registering a `ProfilerRouteSource` with the core (mirroring how entrypoint types are registered). Each `RouteGroup` it returns becomes one view; set `itemLabel` when its entries are not routes, so the count reads `3 commands` rather than `3 routes`:

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
