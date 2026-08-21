---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-rabbitmq': minor
'@eleven-labs/nest-profiler-routes': minor
---

Report the whole RabbitMQ surface in **Discover / RabbitMQ**, not just a one-line locator per handler.

The view listed one row per `@RabbitSubscribe` with its `exchange → routingKey` and nothing else, which is the least interesting half of a broker setup: the dead-letter exchange a queue routes to, the retry queue that TTLs back into it, the exchanges an application only publishes to and the connection a handler actually runs on were all invisible. The RabbitMQ source now reports both halves, read from the resolved `RabbitMQModule` configuration — no management-API call, no extra credentials, and it stays accurate while the broker is unreachable.

- **The declared topology**, as sections above the handler list: **Connections** (broker URI with credentials masked, prefetch, channels, handler configs), **Exchanges** (type, durability flags, arguments), **Queues** (the binding that feeds each one, its flags and its `x-…` arguments) and **Exchange bindings** (with their pattern). Queues nothing subscribes to — dead-letter, retry, delay — are listed too, since they carry the flow even though no handler names them.
- **The full subscription** per handler, the way a CLI command documents its arguments and options: **Subscription** (`queue`, `exchange`, `routingKey`, `connection`, module-level `handler config`, `channel`), **Bindings** (multi-exchange `bindings`), **Queue options** (`queueOptions` with `arguments` spread one `x-…` key per row) and **Behaviour** (`allowNonJsonMessages`, `errorBehavior`, `batchOptions`, a custom `deserializer`, …).
- Two golevelup behaviours the view now makes visible: a handler with no `connection` is registered on **every** declared connection (listed once per connection — the multi-vhost trap that asserts a queue on the wrong vhost), and a handler whose `name` matches no entry in that connection's `handlers` map is **not registered** at all, which the entry states in place of its description. Module-level `handlers` configs are merged into the displayed options exactly as golevelup merges them.

Core: `DiscoverGroup` gains an optional `sections` — titled blocks of facts that are not entries (`name`, optional `kind` badge, `detail`, boolean `flags`, free-form `attributes`), exported as `DiscoverSection` / `DiscoverSectionItem`. The Discover panel renders them above the entry list and titles the list by what it holds (`Handlers`) when sections precede it; a group whose entries are empty but whose sections hold something now gets its view, so a broker an application only publishes to is still reported.
