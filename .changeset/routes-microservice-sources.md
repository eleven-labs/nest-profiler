---
'@eleven-labs/nest-profiler-rabbitmq': minor
'@eleven-labs/nest-profiler-commander': minor
---

Contribute **RabbitMQ** and **Commands** groups to the Routes panel (`@eleven-labs/nest-profiler-routes`).

- `@eleven-labs/nest-profiler-rabbitmq`: `RabbitMqRouteSource` scans `@RabbitSubscribe` handlers (via the `RABBIT_HANDLER` metadata) and lists each consumer with its exchange, routing key and handler.
- `@eleven-labs/nest-profiler-commander`: `CommanderRouteSource` scans nest-commander `@Command()` classes and lists each command with its name, declaring class and `--option` flags.

Both self-register a `ProfilerRouteSource` with the core at bootstrap, so they appear in the panel automatically when the Routes panel package is installed.
