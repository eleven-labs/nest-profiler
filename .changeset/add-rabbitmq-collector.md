---
'@eleven-labs/nest-profiler-rabbitmq': minor
---

New package: capture RabbitMQ messages consumed via `@RabbitSubscribe` (`@golevelup/nestjs-rabbitmq`).

`RabbitMqCollectorModule.forRoot()` registers a context adapter for the `rmq` execution context that creates a fresh profile per consumed message with a `rabbitmq` entrypoint (`entrypoint.type = 'rabbitmq'`, the message details — exchange, routing key, handler, redelivered flag, AMQP tags, masked headers and payload — on `entrypoint.data`). The package owns its `RabbitMqInfo` type and `RABBITMQ_ENTRYPOINT_TYPE`, and registers a `rabbitmq` entrypoint type so messages render in their own **RabbitMQ** list table and on a built-in **Message** detail tab (the HTTP request/response tabs are hidden, like CLI commands). The list has its own filter bar — **Delivery** (first delivery / redelivered), **Exchange** and **Handler** (options built from the captured messages) and a free-text **Routing key** — while the HTTP-status filters are hidden, since a message has no HTTP response. Options: `enabled`, `captureHeaders`, `captureBody`, `maskHeaders`.
