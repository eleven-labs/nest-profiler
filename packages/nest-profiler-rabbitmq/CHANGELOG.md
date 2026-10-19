# @eleven-labs/nest-profiler-rabbitmq

## 1.2.1

### Patch Changes

- 18c1e52: Support `nestjs-cls` 7: the peer dependency now accepts `^6.0.0 || ^7.0.0`.

  With `nestjs-cls` 7, the MikroORM collector captured no queries. `nestjs-cls` now ships an ESM build next to its CommonJS one, so the `ClsService` this ESM package imported was not the class the core registered, and resolving it found nothing. The collector now reads the request context through `ClsServiceManager`, which `nestjs-cls` shares between its two builds.

## 1.0.0

### Major Changes

- 3a507ec: First stable release. `@eleven-labs/nest-profiler-rabbitmq` brings RabbitMQ (`@golevelup/nestjs-rabbitmq`) into the profiler, in both directions.

  - **Messages you consume** — `RabbitMqCollectorModule` turns every `@RabbitSubscribe` delivery into its own profile, with a **RabbitMQ** sidebar view and a **Message** detail tab.
  - **Messages you publish** — `RabbitMqPublishCollectorModule` lists every `AmqpConnection.publish` made during a profiled execution with its exchange, routing key, headers, payload, duration and outcome.
  - The two are independent: register the one that matches what the application does, or both.
  - `RabbitMqDiscoverSource` contributes the **Discover / RabbitMQ** view — the declared topology (connections, exchanges, queues, bindings) followed by every consumer and its subscription.
  - A message carries no status, so the default error definition is "the handler threw"; narrow it with `error.exceptions` when a handler throws as flow control.

  Requires Node >= 22, NestJS 11 and `@eleven-labs/nest-profiler` ^1.0.0, with `@golevelup/nestjs-rabbitmq` ^9 and `amqplib` ^0.10 as peers.

  Documentation: https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-rabbitmq
