`@eleven-labs/nest-profiler` captures logs per execution: every entry written while a request (or CLI command) is being handled lands in that profile's **Logs** tab. The capture is a transparent proxy around your existing logger — it is **logger-agnostic** and works with NestJS's `ConsoleLogger`, `nestjs-pino`, `nest-winston` or any custom `LoggerService`.

![Logs tab showing messages with context names and structured JSON payloads](../../../docs/public/screenshots/profiler/logs.png)

## Enable log capture

Wrap the application logger with the standalone `createProfilerLogger()` where the app is bootstrapped. It is **DI-free** — it reads the active profile from the CLS store, so it needs no `TracerService` and there is no `app.get(...)` to make. When the profiler is off (or a log happens outside a request) it is a transparent pass-through, so no line is lost.

With the recommended [dev-dependency install](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#recommended-install-it-as-a-dev-dependency), this happens in `main-dev.ts` only, through the shared bootstrap's logger hook — production `main.ts` never references the profiler:

```ts title="src/main-dev.ts"
import { createProfilerLogger } from '@eleven-labs/nest-profiler';
import { AppDevModule } from './app.dev.module';
import { bootstrap } from './bootstrap';

void bootstrap(AppDevModule, { wrapLogger: (logger) => createProfilerLogger(logger) });
```

Which boils down to:

```ts
const app = await NestFactory.create(AppDevModule, { bufferLogs: true });
app.useLogger(createProfilerLogger(new ConsoleLogger('MyApplication')));
```

With the [runtime gate](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#when-production-code-calls-the-profiler-conditionalmodule) (profiler in production `dependencies`), make the same `app.useLogger(createProfilerLogger(...))` call in `main.ts`, unconditionally.

The wrapper returns the **same type** as the logger you pass in: it captures the level methods and forwards everything else, so the original logger keeps working exactly as before.

### Loggers that bypass `app.useLogger()`

`app.useLogger()` only routes logs that go through NestJS's `Logger` — so in services, prefer `new Logger(MyService.name)` over instantiating a `ConsoleLogger` directly. A logger **injected directly** (e.g. `nestjs-pino`'s `PinoLogger`, or your own `LoggerService` provider) bypasses it too, and needs wrapping itself.

With the dev-dependency install, production code cannot import `createProfilerLogger`, so leave an optional seam that the dev bundle fills — see [Logs](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#recommended-install-it-as-a-dev-dependency) in the install guide for the `LOGGER_WRAP` token pattern. With the runtime gate, wrap the instance where it is injected:

```ts
constructor(@InjectPinoLogger(MyService.name) pinoLogger: PinoLogger) {
  // pino's own `info()` keeps working AND is now captured into the profile
  this.logger = createProfilerLogger(pinoLogger);
}
```

## What a log entry contains

Each captured call is stored as a [`LogEntry`](https://nest-profiler.eleven-labs.com/docs/api-reference/nest-profiler#logentry):

- `level` — profiler level (`log`, `warn`, `error`, `debug`, `verbose`, `fatal`), mapped from the method name.
- `message` — the human-readable text.
- `context` — the logger context **name**, e.g. the class name passed to `new Logger(...)` or `setContext()`.
- `data` — the structured **payload** extracted from the call arguments, rendered as a JSON block in the UI.
- `spanId` — the trace span that was open when the line was written, when there was one.
- `timestamp` — when the call happened.

`context` and `data` are two different things: the first tells you _who_ logged, the second carries _what_ was logged alongside the message.

`spanId` is what places a line inside the execution trace rather than in a flat list beside it: a line written inside a `tracer.span('checkout.payment', …)` is attributed to that span. It is read from the async context at the moment of the call, so the writer and the reader agree by construction rather than by a timing heuristic.

## Supported call conventions

Loggers disagree on argument order. The default parser classifies the common conventions automatically.

### Message first

The most common style — the message comes first, optionally followed by a payload object and/or a context name:

```ts
logger.log('User created'); // message only
logger.log('User created', 'UsersService'); // trailing string → context name
logger.log('User created', { userId: 42 }); // object → data
logger.log('User created', { userId: 42 }, 'UsersService'); // payload + context name
```

The NestJS `Logger` facade appends the class name automatically, so inside a service `new Logger(UsersService.name)` + `this.logger.log('User created', { userId: 42 })` produces all three fields at once.

### Object first (pino)

pino and `nestjs-pino`'s `PinoLogger` put the merging object **before** the message:

```ts
logger.info({ userId: 42 }, 'User created'); // merging object → data, message second
logger.error(new Error('kaput')); // Error → data { name, message, stack }
logger.error(err, 'Payment failed'); // explicit message wins, err serialized as data
```

### How the context name is resolved

1. A trailing string argument is read as the context name (the NestJS convention) — unless the message contains printf tokens that consume it, or the string looks like a stack trace.
2. When the arguments carry no context name, the logger's own `context` property is used as a fallback. This is how a directly-injected `PinoLogger` shows the name given to `@InjectPinoLogger(MyService.name)`, and how `new ConsoleLogger('MyApplication')` names entries that bypass the facade.

> **Ambiguous calls** — a `(object, string)` call is inherently ambiguous between pino's `(mergingObject, message)` and a NestJS object-message followed by a context name; the pino interpretation wins. For a logger with a genuinely different convention, pass a custom [`parseArgs`](#custom-argument-parser).

## Edge cases handled

- **printf interpolation** — in `logger.log('%s did %d things', 'bob', 3, 'UsersService')` the two interpolation arguments are stored as `data` and never mistaken for a context name.
- **`error(message, stack, context)`** — the NestJS error contract is recognized: the stack string is stored as `data: { stack }`, not as the context name.
- **`Error` instances** — serialized as `{ name, message, stack }` wherever they appear in the arguments.

## Payloads are made JSON-safe

Before storage, `data` is sanitized so a log payload can never break profile persistence: circular references become `'[Circular]'`, `BigInt` and `Date` are converted to strings, `Map`/`Set` become entry arrays, and depth, item-count and string-length caps keep payloads bounded.

## Customize the capture

### Method → level map

The default mapping already knows the common third-party method names (pino's `info` → `log`, `trace` → `verbose`, …). Extend it for extra methods:

```ts
import { DEFAULT_LOG_METHODS } from '@eleven-labs/nest-profiler';

createProfilerLogger(myLogger, {
  logMethods: { ...DEFAULT_LOG_METHODS, silly: 'verbose' },
});
```

### Trace id prefix

Every forwarded line is prefixed with the profile's trace id, so a line scrolling in a terminal — or landing in an aggregator — leads back to the profile that produced it:

```
[3f2a91c4-...] Fetching articles from external API (MISS)
```

Only the **forwarded** message is prefixed; the entry stored on the profile keeps the original text. Turn it off per logger, or globally with the `attachTraceIdToLogs` module option:

```ts
createProfilerLogger(myLogger, { attachTraceIdToLogs: false });
```

Lines written outside a profiled execution are never touched, and only a string message is prefixed — a structured logger takes an object as its first argument, and splicing an id into one would either be dropped or corrupt the payload. See [Correlating with your logs](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#correlating-with-your-logs).

### Custom argument parser

For a logger whose argument convention the default heuristic cannot classify, provide a [`parseArgs`](https://nest-profiler.eleven-labs.com/docs/api-reference/nest-profiler#profilerloggeroptions) function returning the [`ParsedLogCall`](https://nest-profiler.eleven-labs.com/docs/api-reference/nest-profiler#parsedlogcall) to store:

```ts
createProfilerLogger(weirdLogger, {
  parseArgs: (method, args) => ({
    message: String(args[1]),
    data: args[0],
  }),
});
```

The default parser is exported as `parseLogArgs`, so a custom parser can delegate to it for the cases it does not override.

## In the profiler UI

The **Logs** tab lists entries chronologically with the message first, then the context name. When an entry carries `data`, the payload is rendered as a pretty-printed JSON block under the message.

> **Step-by-step tutorial** — [Log capture with context](https://nest-profiler.eleven-labs.com/docs/tutorials/log-capture) walks through wiring the capture with `ConsoleLogger`, then with `nestjs-pino`, and inspecting the result in the UI.
