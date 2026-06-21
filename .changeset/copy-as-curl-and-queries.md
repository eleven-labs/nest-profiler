---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-http': minor
'@eleven-labs/nest-profiler-mongoose': minor
'@eleven-labs/nest-profiler-rabbitmq': minor
---

Add Symfony-style "copy" buttons to the profiler UI so captured operations can be replayed in one click.

- `nest-profiler`: copy the incoming HTTP request as a runnable `curl` command, and copy each SQL query with its bound parameters inlined (supports both `$N` Postgres/TypeORM and `?` MySQL/MikroORM placeholders). Exposes `buildCurlCommand` and `interpolateSql`.
- `nest-profiler-http`: copy each outgoing HTTP client request as `curl`.
- `nest-profiler-mongoose`: copy each query as a runnable `mongosh` command; aggregation pipelines are now captured so `aggregate` copies are complete.
- `nest-profiler-rabbitmq`: copy the message payload and a ready-to-run amqplib `channel.publish(...)` snippet.
