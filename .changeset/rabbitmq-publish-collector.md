---
'@eleven-labs/nest-profiler-rabbitmq': minor
'@eleven-labs/nest-profiler': patch
---

Profile the AMQP messages an application **publishes**, not just the ones it consumes.

- New `RabbitMqPublishCollectorModule.forRoot()` / `.forRootAsync()` adds an **AMQP** panel listing every `AmqpConnection.publish` made while a profile was active: exchange, routing key, AMQP properties (`messageId`, `appId`, `correlationId`, `replyTo`), masked headers, captured payload, duration and outcome — plus a copy button holding a runnable `channel.publish(...)` snippet. Options: `enabled`, `captureHeaders`, `captureBody`, `maskHeaders`, `payloadLimits`, `slowThreshold`, `nPlusOneThreshold`, `chattyThreshold`, the matching severities and `error`.
- Entries are tagged by the core rule engine in a new `amqp` domain, so a publish repeated once per loop iteration surfaces as N+1, a slow broker write as `slow`, and a rejected publish as `error`. A message the channel buffered (`publish()` resolving to `false`) is reported as `buffered` rather than an error. New public `AmqpPublishEntry` type.
- The module is independent of `RabbitMqCollectorModule`: a publish-only API registers just this one, a consumer just the other, and an application doing both gets the publishes of its consumers listed on their message profiles. It works under any entrypoint (HTTP request, CLI command, consumed message) since the panel is profile-scoped. `nestjs-cls` joins the package's peer dependencies, as in every other collector package.
- Core: the built-in performance rules no longer hardcode `query`/`request` wording — the N+1 detail and the default `chattyThreshold` are resolved per rule domain, so a non-query collector reads correctly ("Same message executed 3 times").
