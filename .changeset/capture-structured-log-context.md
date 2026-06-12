---
'@eleven-labs/nest-profiler': minor
---

Capture structured log context and show it in the Logs tab.

- `createLogger()` now understands the three common call conventions: NestJS (`log(message, context)`, including the `error(message, stack, context)` contract), pino / nestjs-pino `PinoLogger` (`info(mergingObject, message)` — merging object first) and the message-first style `log(message, payloadObject)`. Structured payloads land in the new `LogEntry.data` field; `LogEntry.context` keeps holding the logger context name. Printf interpolation arguments (`%s`-style tokens) and stack-shaped strings are never mistaken for a context name.
- When the call arguments carry no context name, the adapter falls back to the delegate's own `context` property — a directly-injected `PinoLogger` (`@InjectPinoLogger(MyService.name)`) finally shows its context in the profiler.
- `Error` arguments are serialized as `{ name, message, stack }` and every payload is made JSON-safe before storage (circular references, `BigInt`, `Date`, `Map`/`Set`, depth/size/string-length caps), so a profile can no longer fail to persist because of a log payload.
- The Logs tab now shows the Message column before Context and renders `data` as a pretty-printed JSON block under the message.
- `createLogger(delegate, options)` accepts `{ logMethods, parseArgs }` to override which methods are intercepted and how arguments are classified; passing a plain `LogMethodMap` as before keeps working. The default parser is exported as `parseLogArgs`.
