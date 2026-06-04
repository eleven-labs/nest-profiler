---
'@eleven-labs/nest-profiler': minor
---

Make log capture logger-agnostic via transparent Proxy

`ProfilerService.createLogger` now wraps any logger (NestJS `LoggerService`, nestjs-pino `PinoLogger`, or any custom logger) in a transparent `Proxy` instead of a fixed class. Level methods are intercepted and forwarded to the profiler; all other methods and properties pass through to the delegate unchanged, preserving the original return type.

- New exports: `createProfilerLogger`, `DEFAULT_LOG_METHODS`, `LogMethodMap`
- `DEFAULT_LOG_METHODS` covers standard NestJS levels (`log`, `error`, `warn`, `debug`, `verbose`, `fatal`) plus common third-party aliases (`info` → `log`, `trace` → `verbose`)
- Pass a custom `LogMethodMap` to `createProfilerLogger` for other loggers
- Directly-injected loggers (e.g. nestjs-pino `PinoLogger` via `@Optional()`) can now be wrapped with `createProfilerLogger` to capture their calls even when they bypass `app.useLogger()`
