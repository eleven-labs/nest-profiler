---
'@eleven-labs/nest-profiler-routes': minor
'@eleven-labs/nest-profiler': minor
---

Show which REST routes are protected by a guard in the Routes panel.

Each route now surfaces the guard classes applied via `@UseGuards()` on its controller and/or handler (e.g. an authentication guard): guarded routes show a lock, and expanding a route lists its guards. The core `RouteEntry` type gains an optional `guards?: string[]` field, and the routes package exports a `readRouteGuards()` helper. Only route-level guards are reflected — a global `APP_GUARD` is not attached per handler.
