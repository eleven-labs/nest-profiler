# @eleven-labs/nest-profiler-routes

## 1.0.0-alpha.10

### Patch Changes

- 1735b38: Document the `@alpha` install tag in every package README.

  - Install commands now pin `@eleven-labs/nest-profiler*` packages to the `@alpha` dist-tag, since there is no stable release yet (`@latest` resolves to nothing).
  - Added a short note next to each install snippet explaining the requirement.

## 1.0.0-alpha.9

### Patch Changes

- a3ba8ee: Make the profiler-UI tables horizontally scrollable on narrow/mobile viewports (fixes #184).

  Every list-section table (HTTP, GraphQL, Command, RabbitMQ) and several collector-panel tables (schema, timeline, routes, cache, validator) were wrapped in an `overflow-hidden` container (there to clip the rounded corners), which also clipped horizontal overflow with no scrollbar — so on a phone the wide tables were squished and the right-hand columns became unreachable. Each wide table now sits in an `overflow-x-auto` container with a sensible `min-w`, so a table too wide to fit scrolls horizontally within its own card (rounded corners preserved) while the page body itself never scrolls sideways.

## 1.0.0-alpha.8

### Minor Changes

- a8a149b: Show which REST routes are protected by a guard in the Routes panel.

  Each route now surfaces the guard classes applied via `@UseGuards()` on its controller and/or handler (e.g. an authentication guard): guarded routes show a lock, and expanding a route lists its guards. The core `RouteEntry` type gains an optional `guards?: string[]` field, and the routes package exports a `readRouteGuards()` helper. Only route-level guards are reflected — a global `APP_GUARD` is not attached per handler.

- a8a149b: New package: a **Routes** panel for the profiler home page — a Symfony-Routing-style view of the application's routing table.

  `RoutesCollectorModule.forRoot()` contributes a global-scope panel listing every registered route grouped by transport. It ships a built-in **REST** source that discovers request-mapped handlers at startup and, per route, introspects the path params (from the route path), query params and headers (from `@Query`/`@Headers`), and the `@Body()` DTO — its class name, top-level decorated properties, TypeScript types and (when `class-validator` is installed, an optional peer) the validation rules. Other transport packages contribute their own group by registering a `ProfilerRouteSource` with the core.

  The core now exposes the route-source extension point consumed by the panel: the `ProfilerRouteSource` / `RouteGroup` / `RouteEntry` / `RouteInputs` types, `ProfilerCoreService.registerRouteSource()` / `getRouteSources()`, and the shared `scanHttpRoutes()` route-discovery helper (also used internally by the request-to-handler matcher). Fixes a latent double-slash bug in route path construction (`@Get('/_profiler')` now yields `/_profiler` instead of `//_profiler`).
