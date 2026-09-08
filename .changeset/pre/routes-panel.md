---
'@eleven-labs/nest-profiler-routes': minor
'@eleven-labs/nest-profiler': minor
---

New package: a **Routes** panel for the profiler home page — a Symfony-Routing-style view of the application's routing table.

`RoutesCollectorModule.forRoot()` contributes a global-scope panel listing every registered route grouped by transport. It ships a built-in **REST** source that discovers request-mapped handlers at startup and, per route, introspects the path params (from the route path), query params and headers (from `@Query`/`@Headers`), and the `@Body()` DTO — its class name, top-level decorated properties, TypeScript types and (when `class-validator` is installed, an optional peer) the validation rules. Other transport packages contribute their own group by registering a `ProfilerRouteSource` with the core.

The core now exposes the route-source extension point consumed by the panel: the `ProfilerRouteSource` / `RouteGroup` / `RouteEntry` / `RouteInputs` types, `ProfilerCoreService.registerRouteSource()` / `getRouteSources()`, and the shared `scanHttpRoutes()` route-discovery helper (also used internally by the request-to-handler matcher). Fixes a latent double-slash bug in route path construction (`@Get('/_profiler')` now yields `/_profiler` instead of `//_profiler`).
