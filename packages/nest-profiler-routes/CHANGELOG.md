# @eleven-labs/nest-profiler-routes

## 1.0.0-alpha.17

### Major Changes

- 46a05ab: Name the Discover contract after **Discover**, and RabbitMQ after **RabbitMQ**.

  Two naming inconsistencies had survived the move to per-transport Discover views. The extension point was still called `Route*` while three of its four sources contribute no routes at all — a CLI command, a GraphQL field and a message handler are not routes — and the publish panel was labelled **AMQP** next to a **RabbitMQ** list section, a **RabbitMQ** detail tab and a **RabbitMQ** Discover view, so one broker carried two names.

  Discover contract (core, and every source implementing it):

  - `ProfilerRouteSource` → `ProfilerDiscoverSource`, `RouteGroup` → `DiscoverGroup`, `RouteEntry` → `DiscoverEntry`, `RouteInputs` / `RouteInputGroup` / `RouteInputItem` → `DiscoverInputs` / `DiscoverInputGroup` / `DiscoverInputItem`, `RouteDtoInfo` / `RouteDtoProperty` → `DiscoverDtoInfo` / `DiscoverDtoProperty`.
  - `ProfilerCoreService.registerRouteSource()` → `registerDiscoverSource()`, `getRouteSources()` → `getDiscoverSources()`.
  - `DiscoverGroup.routes` → `DiscoverGroup.entries`, and `RoutesCollectorData.routeCount` → `entryCount`.
  - The shipped sources follow: `HttpRouteSource` → `HttpDiscoverSource`, `GraphqlRouteSource` → `GraphqlDiscoverSource`, `RabbitMqRouteSource` → `RabbitMqDiscoverSource`, `CommanderRouteSource` → `CommanderDiscoverSource`.

  `@eleven-labs/nest-profiler-routes`, `RoutesCollectorModule` and `RoutesCollector` keep their names — the package still ships the built-in HTTP source and owns the panel — as does `RouteCollector`, the core's HTTP route matcher, which is unrelated to Discover.

  RabbitMQ naming:

  - The publish panel is labelled **RabbitMQ** instead of **AMQP**, and its rule domain is `rabbitmq` instead of `amqp`, so a chatty profile reads `12 rabbitmq calls in one request`. The core's per-domain defaults (`chattyThreshold`, the N+1 subject) move with it.
  - `AmqpPublishEntry` → `RabbitMqPublishEntry`. Internals follow suit (`AmqpPublishPatch` → `RabbitMqPublishPatch`, `buildAmqpPublish` → `buildRabbitMqPublish`), and the remaining prose says "RabbitMQ" where it used to say "AMQP", keeping the term only where it names the wire protocol itself.

  BREAKING: every renamed symbol above is a published export. No behaviour changes — a consumer importing one updates the import name, and a custom `ProfilerDiscoverSource` renames its `routes` field to `entries`. Nothing in the `?view=` keys, the storage format or the module options changes.

### Minor Changes

- 46a05ab: Report the whole RabbitMQ surface in **Discover / RabbitMQ**, not just a one-line locator per handler.

  The view listed one row per `@RabbitSubscribe` with its `exchange → routingKey` and nothing else, which is the least interesting half of a broker setup: the dead-letter exchange a queue routes to, the retry queue that TTLs back into it, the exchanges an application only publishes to and the connection a handler actually runs on were all invisible. The RabbitMQ source now reports both halves, read from the resolved `RabbitMQModule` configuration — no management-API call, no extra credentials, and it stays accurate while the broker is unreachable.

  - **The declared topology**, as sections above the handler list: **Connections** (broker URI with credentials masked, prefetch, channels, handler configs), **Exchanges** (type, durability flags, arguments), **Queues** (the binding that feeds each one, its flags and its `x-…` arguments) and **Exchange bindings** (with their pattern). Queues nothing subscribes to — dead-letter, retry, delay — are listed too, since they carry the flow even though no handler names them.
  - **The full subscription** per handler, the way a CLI command documents its arguments and options: **Subscription** (`queue`, `exchange`, `routingKey`, `connection`, module-level `handler config`, `channel`), **Bindings** (multi-exchange `bindings`), **Queue options** (`queueOptions` with `arguments` spread one `x-…` key per row) and **Behaviour** (`allowNonJsonMessages`, `errorBehavior`, `batchOptions`, a custom `deserializer`, …).
  - Two golevelup behaviours the view now makes visible: a handler with no `connection` is registered on **every** declared connection (listed once per connection — the multi-vhost trap that asserts a queue on the wrong vhost), and a handler whose `name` matches no entry in that connection's `handlers` map is **not registered** at all, which the entry states in place of its description. Module-level `handlers` configs are merged into the displayed options exactly as golevelup merges them.

  Core: `DiscoverGroup` gains an optional `sections` — titled blocks of facts that are not entries (`name`, optional `kind` badge, `detail`, boolean `flags`, free-form `attributes`), exported as `DiscoverSection` / `DiscoverSectionItem`. The Discover panel renders them above the entry list and titles the list by what it holds (`Handlers`) when sections precede it; a group whose entries are empty but whose sections hold something now gets its view, so a broker an application only publishes to is still reported.

## 1.0.0-alpha.16

### Minor Changes

- 74d8986: Replace the single **Routes** panel with one **Discover** view per transport.

  "Routes" named the panel after one transport's vocabulary while listing four, and answered a question nobody asks that way: you look up the HTTP table, or the CLI's commands, not "all routes". Each registered `ProfilerRouteSource` now contributes its own sidebar view under a **Discover** heading — `Discover / HTTP`, `Discover / GraphQL`, `Discover / Commands`, `Discover / RabbitMQ` — each rendering that transport's table flat, with no group disclosure to open first, and counting its entries with the source's own noun (`4 commands`, `9 fields`). A transport that discovered nothing gets no view, so the sidebar lists only what the application actually registered.

  The `routes.png` screenshot is renamed `discover.png` and reshot on the HTTP view. The views are ordered deterministically — the built-in HTTP source first, then the other transports by label — instead of following the DI bootstrap order, which shuffled the sidebar between runs. They are keyed `discover-<transport>` in `?view=`, so they can never collide with the same-protocol profile list: `?view=graphql` stays the GraphQL list, `?view=discover-graphql` is its routing table. `discoverViewKey()`, `DISCOVER_GROUP` and `DISCOVER_GROUP_LABEL` are exported for consumers building their own links. The GraphQL, RabbitMQ and Commands sources declare the `itemLabel` their entries deserve; nothing else changes in how a source is registered.

### Patch Changes

- 0514af8: The Routes panel no longer lists the profiler's own UI/API routes (`/_profiler/...`).

  - `@eleven-labs/nest-profiler` exports `PROFILER_BASE_PATH`, the fixed base path where the profiler UI is mounted.
  - `HttpRouteSource` filters out any scanned route whose path starts with `PROFILER_BASE_PATH` before building the **REST** group.

- 74d8986: Make the home page's sidebar identical to a profile's, and give each subject exactly one glyph.

  The two navigations had drifted into two components: the home page indented its items further (`pl-6` against the detail page's `pl-3`), used a thinner separator and its own header padding, rendered a flat count badge where the detail page accents the active one, and carried no icon at all on the **Profiling** items. Both now share one nav-item partial — same padding, same badge scale, same active accent — and both render the icon in a fixed-width slot, so an item that declares no icon still lines its label up with the others.

  `ProfilerListSection` gains an optional `icon`. A protocol now keeps **one** glyph everywhere it is named, across both pages: the HTTP globe is defined once in the core (exported as `HTTP_ICON`) and used by the HTTP list section, the HTTP routing table and the HTTP Client collector panel; the GraphQL mark serves both the GraphQL list section and the GraphQL detail tab. That retires two near-duplicate marks — a second terminal glyph for Commands and a second GraphQL glyph — which existed only because each file defined its own copy. Tabs naming a _content_ rather than a protocol (Request, Response, Message, Performance…) keep their own icon.

  The HTTP routing table is labelled **HTTP** rather than **REST**, so the sidebar names the protocol once: `Profiling / HTTP` and `Discover / HTTP`, same word, same globe. `RouteGroup.label` for the built-in source changes accordingly; the `?view=discover-http` key is unchanged.

## 1.0.0-alpha.15

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.14

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.13

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.12

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.11

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

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
