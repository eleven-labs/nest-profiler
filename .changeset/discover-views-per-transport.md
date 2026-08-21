---
'@eleven-labs/nest-profiler-routes': minor
'@eleven-labs/nest-profiler-commander': patch
'@eleven-labs/nest-profiler-graphql': patch
'@eleven-labs/nest-profiler-rabbitmq': patch
---

Replace the single **Routes** panel with one **Discover** view per transport.

"Routes" named the panel after one transport's vocabulary while listing four, and answered a question nobody asks that way: you look up the HTTP table, or the CLI's commands, not "all routes". Each registered `ProfilerRouteSource` now contributes its own sidebar view under a **Discover** heading — `Discover / HTTP`, `Discover / GraphQL`, `Discover / Commands`, `Discover / RabbitMQ` — each rendering that transport's table flat, with no group disclosure to open first, and counting its entries with the source's own noun (`4 commands`, `9 fields`). A transport that discovered nothing gets no view, so the sidebar lists only what the application actually registered.

The `routes.png` screenshot is renamed `discover.png` and reshot on the HTTP view. The views are ordered deterministically — the built-in HTTP source first, then the other transports by label — instead of following the DI bootstrap order, which shuffled the sidebar between runs. They are keyed `discover-<transport>` in `?view=`, so they can never collide with the same-protocol profile list: `?view=graphql` stays the GraphQL list, `?view=discover-graphql` is its routing table. `discoverViewKey()`, `DISCOVER_GROUP` and `DISCOVER_GROUP_LABEL` are exported for consumers building their own links. The GraphQL, RabbitMQ and Commands sources declare the `itemLabel` their entries deserve; nothing else changes in how a source is registered.
