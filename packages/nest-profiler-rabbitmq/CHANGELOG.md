# @eleven-labs/nest-profiler-rabbitmq

## 1.0.0-alpha.6

### Minor Changes

- 8516122: Add Symfony-style "copy" buttons to the profiler UI so captured operations can be replayed in one click.

  - `nest-profiler`: copy the incoming HTTP request as a runnable `curl` command, and copy each SQL query with its bound parameters inlined (supports both `$N` Postgres/TypeORM and `?` MySQL/MikroORM placeholders). Exposes `buildCurlCommand` and `interpolateSql`.
  - `nest-profiler-http`: copy each outgoing HTTP client request as `curl`.
  - `nest-profiler-mongoose`: copy each query as a runnable `mongosh` command; aggregation pipelines are now captured so `aggregate` copies are complete.
  - `nest-profiler-rabbitmq`: copy the message payload and a ready-to-run amqplib `channel.publish(...)` snippet.

## 1.0.0-alpha.5

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.4

### Minor Changes

- 13e53f8: New package: capture RabbitMQ messages consumed via `@RabbitSubscribe` (`@golevelup/nestjs-rabbitmq`).

  `RabbitMqCollectorModule.forRoot()` registers a context adapter for the `rmq` execution context that creates a fresh profile per consumed message with a `rabbitmq` entrypoint (`entrypoint.type = 'rabbitmq'`, the message details — exchange, routing key, handler, redelivered flag, AMQP tags, masked headers and payload — on `entrypoint.data`). The package owns its `RabbitMqInfo` type and `RABBITMQ_ENTRYPOINT_TYPE`, and registers a `rabbitmq` entrypoint type so messages render in their own **RabbitMQ** list table and on a built-in **Message** detail tab (the HTTP request/response tabs are hidden, like CLI commands). The list has its own filter bar — **Delivery** (first delivery / redelivered), **Exchange** and **Handler** (options built from the captured messages) and a free-text **Routing key** — while the HTTP-status filters are hidden, since a message has no HTTP response. Options: `enabled`, `captureHeaders`, `captureBody`, `maskHeaders`.
