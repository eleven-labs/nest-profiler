`ProfilerModule` is configured once, in the root module of the application. This page covers the synchronous and asynchronous registration styles, the full options reference, and how to protect the profiler UI with a pluggable security strategy.

## Module registration

```ts title="app.module.ts"
import { Module } from '@nestjs/common';
import { ProfilerModule } from '@eleven-labs/nest-profiler';

@Module({
  imports: [
    ProfilerModule.forRoot({
      isGlobal: true,
      maxProfiles: 100,
    }),
  ],
})
export class AppModule {}
```

The profiler is a development tool — see [Enabling and disabling the profiler](#enabling-and-disabling-the-profiler) below for the recommended way to turn it off in production.

## Async configuration

Use `forRootAsync` when the options depend on injected providers such as `ConfigService`:

```ts title="app.module.ts"
ProfilerModule.forRootAsync({
  useFactory: (config: ConfigService) => ({
    maxProfiles: config.get('PROFILER_MAX_PROFILES', 100),
  }),
  inject: [ConfigService],
});
```

## Enabling and disabling the profiler

The profiler is a development tool — turn it off in production. There are two ways to do it. Log capture keeps working either way: `createProfilerLogger` is DI-free and a transparent pass-through when off (see [Log capture](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/logs)), so you never have to keep `TracerService` alive just for logging.

### Recommended: `ConditionalModule`

Gate the active `ProfilerModule` with Nest's `ConditionalModule.registerWhen`. When profiling is off, the active module — with its middleware, interceptor, storage and collectors — is never loaded, so the disabled path costs nothing.

```ts title="app.module.ts"
import { ProfilerModule } from '@eleven-labs/nest-profiler';
import { ConditionalModule } from '@nestjs/config';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] === 'true';

@Module({
  imports: [
    ConditionalModule.registerWhen(
      ProfilerModule.forRootAsync({ isGlobal: true, useFactory: () => ({ maxProfiles: 100 }) }),
      isProfilerEnabled,
    ),
  ],
})
export class AppModule {}
```

The condition is a plain `(env) => boolean`. Gate each optional collector package (`@eleven-labs/nest-profiler-http`, `-config`, …) the same way — they need no no-op counterpart, as they self-register through discovery.

#### Keep `TracerService` resolvable when off: `ProfilerNoopModule`

If a service (or `main.ts`) injects `TracerService` **directly** — for trace spans (`span`), a caught error (`captureError`) or the current debug token (`currentToken`) — that injection would fail to resolve when the active module is gated out. Register `ProfilerNoopModule` as the fallback so it resolves with none of its optional dependencies instead (no CLS store, and the async options factory never runs), which is exactly what makes every method a no-op:

```ts title="app.module.ts"
import { ProfilerModule, ProfilerNoopModule } from '@eleven-labs/nest-profiler';

ConditionalModule.registerWhen(ProfilerModule.forRoot({ isGlobal: true }), isProfilerEnabled),
ConditionalModule.registerWhen(
  ProfilerNoopModule.forRoot({ isGlobal: true }),
  (env) => !isProfilerEnabled(env),
),
```

Register it with the same `isGlobal` as the active module. An app that only captures logs and reads collector panels never injects `TracerService`, so it does **not** need this fallback — gate the active module alone.

> **CLI apps (`nest-commander`):** `ConditionalModule.registerWhen` `await`s `ConfigModule.envVariablesLoaded` from `@nestjs/config`, which only resolves once `ConfigModule.forRoot()` has run. An HTTP app's root module usually imports it already, but a CLI bootstrapped with `CommandFactory` may not — and without it, registration hangs and the process exits `0` **silently** (no logs, no error, since the internal timeout is `unref`'d). If you use this gating in a CLI, import `ConfigModule.forRoot()` in its root module. See [Command profiling](https://nest-profiler.eleven-labs.com/docs/tutorials/commander-collector) and the [troubleshooting guide](https://nest-profiler.eleven-labs.com/docs/troubleshooting).

#### Keep the root tidy: bundle into a `ProfilingModule`

When several profiler modules live at the composition root (the core plus root-level collectors such as config, validator or commander), group them into a single module so the root keeps a **single** gate for the active bundle (plus the no-op fallback only if the app injects `TracerService` directly):

```ts title="profiling.module.ts"
import { DynamicModule, Module } from '@nestjs/common';
import { ProfilerModule } from '@eleven-labs/nest-profiler';
import { ConfigCollectorModule } from '@eleven-labs/nest-profiler-config';
import { ValidatorCollectorModule } from '@eleven-labs/nest-profiler-validator';

@Module({})
export class ProfilingModule {
  static forRoot(): DynamicModule {
    return {
      module: ProfilingModule,
      imports: [
        ProfilerModule.forRoot({ isGlobal: true }),
        ConfigCollectorModule.forRoot(),
        ValidatorCollectorModule.forRoot(),
      ],
    };
  }
}
```

```ts title="app.module.ts"
@Module({
  imports: [
    ConditionalModule.registerWhen(ProfilingModule.forRoot(), isProfilerEnabled),
    // Add this second gate only if a service injects TracerService directly (custom spans, events…):
    // ConditionalModule.registerWhen(
    //   ProfilerNoopModule.forRoot({ isGlobal: true }),
    //   (env) => !isProfilerEnabled(env),
    // ),
  ],
})
export class AppModule {}
```

**Infra-scoped** collectors (database, HTTP client, cache, messaging, GraphQL transport…) stay co-located in the bounded-context module that owns their infrastructure, each gated with its own `ConditionalModule.registerWhen(...)` — they cannot join the bundle because they must sit next to the `HttpModule` / ORM / broker they instrument. The [example app](https://nest-profiler.eleven-labs.com/docs/example-api) demonstrates the full pattern.

### Alternative: the `enabled` option

Every profiler module also accepts a top-level `enabled` flag. When `false`, the core registers an **inert layer**: the same `TracerService`, with none of its optional dependencies provided (no CLS store, no active layer), which is exactly what makes every method a no-op — there is no second class to keep in sync:

```ts title="app.module.ts"
ProfilerModule.forRoot({ isGlobal: true, enabled: process.env.NODE_ENV !== 'production' }),
```

Note `enabled` is a **synchronous, top-level** bootstrap flag — with `forRootAsync` it is not resolved by `useFactory` (it must be known before the async factory runs), so it stays outside the factory. The same holds for every **collector** (`-http`, `-typeorm`, `-config`, …): their `forRootAsync` resolves option _values_ only, never `enabled`. So to set `enabled` **together with** options in a single call, use `forRoot({ enabled, ...options })`; to drive options from `ConfigService` while toggling per environment — the **recommended** approach — gate `forRootAsync` with `ConditionalModule.registerWhen(...)` instead. This is the only place in the docs that details the `enabled` option; prefer `ConditionalModule` everywhere else.

### `devDependency`-only: the dev-entry split

The two strategies above keep the profiler in your production `dependencies` and toggle it at runtime — the right default, and what `ConditionalModule` is for. If instead you want the profiler in `devDependencies` **only**, with a strictly zero production footprint (the package is never installed in prod, never bundled, never imported), use a **dev-entry split** instead of a runtime gate.

The idea: the _entrypoint_ is the switch. Production runs a profiler-free `main.ts` + `AppModule`; a separate `main-dev.ts` + `AppDevModule` — the only files that import the profiler — add it on top for local development. No `PROFILER_ENABLED` gate, no `@nestjs/config`, and no `ProfilerNoopModule`.

> **Requirement:** no production code may inject `TracerService`, import a `@eleven-labs/nest-profiler*` package, or import `nestjs-cls`. If a service injects `TracerService`, its DI can't resolve when the package is absent in prod — so this strategy fits apps that only want request / log / exception / query profiling in development and never call `TracerService` directly. (Those apps need no `ProfilerNoopModule` either.)

**Install as a dev dependency** — every `@eleven-labs/nest-profiler*` package plus `nestjs-cls`:

```bash
pnpm add -D @eleven-labs/nest-profiler@alpha nestjs-cls
```

**Production entry** — no profiler anywhere on the always-executed path:

```ts title="src/main.ts"
import { ConsoleLogger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new ConsoleLogger('App'));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(3000);
}
void bootstrap();
```

`AppModule` and every feature module stay **free of any profiler import**.

**Dev entry** — the only place the profiler is referenced. A tiny dev-only root module composes `AppModule` with the profiler bundle:

```ts title="src/app.dev.module.ts"
import { Module } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { ProfilingModule } from './profiling/profiling.module.js';

@Module({ imports: [AppModule, ProfilingModule.forWeb()] })
export class AppDevModule {}
```

```ts title="src/main-dev.ts"
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createProfilerLogger } from '@eleven-labs/nest-profiler';
import {
  createProfilerValidationPipe,
  createClassValidatorPipe,
} from '@eleven-labs/nest-profiler-validator';
import { AppDevModule } from './app.dev.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppDevModule, { bufferLogs: true });
  // Profiler logger + validation pipe live only here, so production main.ts never references them.
  app.useLogger(createProfilerLogger(new ConsoleLogger('App')));
  app.useGlobalPipes(
    createProfilerValidationPipe(createClassValidatorPipe({ whitelist: true, transform: true })),
  );
  await app.listen(3000);
}
void bootstrap();
```

`ProfilingModule` here bundles the core `ProfilerModule.forRoot({ isGlobal: true, ... })` and **every** collector you use (see [Keep the root tidy](#keep-the-root-tidy-bundle-into-a-profilingmodule)) — no runtime gate, since the module is only ever loaded through `main-dev.ts`.

**Collectors need no feature-module wiring here.** They resolve across the whole DI container, so putting them all in the dev-only bundle is enough:

- The **HTTP** collector's `AxiosInstrumentation` finds axios instances by scanning DI providers (duck-typing `axiosRef`) via `DiscoveryService`; because `AppDevModule` imports `AppModule`, it patches your feature modules' `HttpService` automatically. `FetchInstrumentation` patches the global `fetch`.
- **TypeORM** self-resolves the `DataSource` by connection token; **cache** proxy-wraps the global `CACHE_MANAGER`; **Mongoose** patches `Query`/`Aggregate` execution.
- **GraphQL** only needs your `GraphQLModule` `context` to expose the request (`context: ({ req }) => ({ req })`) — that's plain application config, not a profiler import, so it can stay in the production module.
- **Validation** stays app-owned: production `main.ts` uses a plain `ValidationPipe`; `main-dev.ts` swaps in `createProfilerValidationPipe(createClassValidatorPipe(...))` with the same options, and the panel module (`ValidatorCollectorModule.forRoot()`) goes in the bundle.

**Run and build:**

```jsonc title="package.json"
{
  "scripts": {
    "start:dev": "nest start --entryFile main-dev --watch",
    "build": "nest build",
    "start": "node dist/main.js",
  },
}
```

The dev-only files (`main-dev.ts`, `app.dev.module.ts`, `profiling/**`) reference the dev dependencies, so **compile with the dev dependencies installed** (the standard CI/build environment has them). At runtime production runs `dist/main.js` alone — `dist/main-dev.js` is emitted but never loaded — so the profiler packages can be pruned from the production `node_modules` with no effect.

If a deployment pipeline installs with `--omit=dev` **before** building, `tsc` will fail on the dev-only files. Either exclude them from a production `tsconfig.build.json`, or build with the dev dependencies present and prune afterwards (`npm prune --omit=dev`).

## Options

| Option                  | Type                                                                              | Default         | Description                                                                                                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`               | `boolean`                                                                         | `true`          | Enable or disable the profiler.                                                                                                                                                                                                                                                             |
| `security`              | `ProfilerSecurityOptions`                                                         | —               | Pluggable access control for the UI/API (`authorize` predicate and/or NestJS `guards`, plus `linkQuery`). When omitted the profiler is open (local dev only). See [Securing the UI](#securing-the-ui).                                                                                      |
| `maxProfiles`           | `number`                                                                          | `100`           | Maximum profiles kept (LRU eviction). `0` or negative: no cap.                                                                                                                                                                                                                              |
| `listPageSize`          | `number`                                                                          | `25`            | Profiles shown per page in each dashboard list section (HTTP, GraphQL, RabbitMQ, Commands…). Each section paginates independently.                                                                                                                                                          |
| `ttl`                   | `number`                                                                          | `3600`          | Profile time-to-live in seconds. `0` or negative: never expire.                                                                                                                                                                                                                             |
| `isGlobal`              | `boolean`                                                                         | `false`         | Register the module as a global NestJS module.                                                                                                                                                                                                                                              |
| `timezone`              | `string`                                                                          | `TZ`            | IANA timezone the UI renders every timestamp in (`'Europe/Paris'`, `'UTC'`…). Defaults to the timezone the process runs in, i.e. the one `TZ` selects. See [Timezone of displayed timestamps](#timezone-of-displayed-timestamps).                                                           |
| `storageType`           | `'memory' \| 'file'`                                                              | `'memory'`      | Built-in storage backend.                                                                                                                                                                                                                                                                   |
| `storagePath`           | `string`                                                                          | `.profiler`     | Directory for file storage (relative or absolute).                                                                                                                                                                                                                                          |
| `storage`               | `IProfilerStorageAdapter`                                                         | —               | Custom adapter — takes precedence over `storageType`.                                                                                                                                                                                                                                       |
| `collectBody`           | `boolean`                                                                         | `false`         | Capture request/response bodies (use with caution).                                                                                                                                                                                                                                         |
| `maxBodySize`           | `number`                                                                          | `65536`         | Max serialized size (chars) of a captured body before it is truncated to a placeholder. `0` disables truncation.                                                                                                                                                                            |
| `bodyCaptureLimits`     | `SafeDataOptions`                                                                 | see below       | Inner content caps applied to each captured body **before** `maxBodySize`: `maxStringLength` (`2048`), `maxItems` (`64`), `maxDepth` (`4`). Each is disabled with `0` (or negative). See [Capturing full bodies](#capturing-full-bodies).                                                   |
| `redaction`             | `ProfilerRedactionOptions`                                                        | —               | Unified masking configuration — headers, cookies, query parameters, object keys, extra value patterns and a custom replacement sentinel, in one block. See [Redacting sensitive data](#redacting-sensitive-data).                                                                           |
| `emitDebugHeaders`      | `boolean`                                                                         | `true`          | Emit the `X-Debug-Token` / `X-Debug-Token-Link` response headers on profiled responses. Turn off in shared/staging environments.                                                                                                                                                            |
| `collectorTimeout`      | `number`                                                                          | `1000`          | Max ms a single collector may run before it is abandoned (`0` disables).                                                                                                                                                                                                                    |
| `sampleRate`            | `number`                                                                          | `1.0`           | Fraction of requests to profile (0.0–1.0).                                                                                                                                                                                                                                                  |
| `alwaysProfile`         | `ProfilerForceProfileFilter`                                                      | —               | Force-capture a request past the `sampleRate` roll. See [Forcing capture past sampling](#forcing-capture-past-sampling).                                                                                                                                                                    |
| `ignorePaths`           | `(string \| RegExp)[]`                                                            | `[]`            | Paths to skip profiling (prefix string or RegExp), merged after the defaults.                                                                                                                                                                                                               |
| `useDefaultIgnorePaths` | `boolean`                                                                         | `true`          | Skip noisy browser/tooling requests by default (favicon, robots.txt, the Chrome DevTools `/.well-known/appspecific/com.chrome.devtools.json` probe, apple-touch-icon).                                                                                                                      |
| `ignoreRequest`         | `ProfilerRequestFilter`                                                           | —               | Custom predicate; return `true` to skip profiling. Applied together with `ignorePaths` (either one matching skips the request). Compose several conditions with `combineFilters`.                                                                                                           |
| `debug`                 | `boolean`                                                                         | `false`         | Trace why a request was or wasn't profiled via `Logger.debug`. See [Debugging why a request wasn't profiled](#debugging-why-a-request-wasnt-profiled).                                                                                                                                      |
| `error`                 | `ProfilerErrorOptions`                                                            | 5xx             | What counts as a **failed HTTP request** — what earns the `error` tag and what the list's `Errors` filter keeps. Default: a 5xx status, so 4xx like `401`/`404` are answers, not errors. See [What counts as an error](#what-counts-as-an-error).                                           |
| `performance`           | `ProfilerPerformanceOptions`                                                      | —               | Custom rules for the tagging engine. See [Performance tags](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/performance-tags).                                                                                                                                            |
| `runtime`               | `boolean \| ProfilerRuntimeOptions`                                               | `true`          | Process-level runtime metrics and the **Runtime** dashboard view (memory, CPU, event-loop lag, GC), sampled every `interval` ms (default `5000`, history `120` samples). See [CPU and memory](#cpu-and-memory).                                                                             |
| `sourceContext`         | `boolean \| SourceContextOptions`                                                 | `true`          | Attach a source-code excerpt to every captured exception's application stack frames. See [The exception stack](#the-exception-stack).                                                                                                                                                       |
| `projectRoot`           | `string`                                                                          | `process.cwd()` | Root the application's own source lives under: what tells an application frame from a dependency, and the only directory `sourceContext` may read inside. See [The exception stack](#the-exception-stack).                                                                                  |
| `editor`                | `ProfilerEditorName \| string`                                                    | —               | Turn every source location in the Exceptions tab into a link that opens the file in your editor. See [Opening a frame in your editor](#opening-a-frame-in-your-editor).                                                                                                                     |
| `attributes`            | `Record<string, SummaryPrimitive> \| ((req) => Record<string, SummaryPrimitive>)` | —               | Custom indexed facets attached to every profile. See [Custom indexed attributes](#custom-indexed-attributes).                                                                                                                                                                               |
| `version`               | `string`                                                                          | —               | Build/release identifier stamped on every profile — HTTP, CLI command or consumed message — and shown in its header.                                                                                                                                                                        |
| `traceMinDuration`      | `number`                                                                          | `0`             | Default for the Execution Trace's "Hide under" control (ms). `0` shows every span — hiding by default is the wrong bias for a debugging tool. See [Reading the trace](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/collectors#reading-the-trace-at-the-right-density). |
| `traceIdHeader`         | `string`                                                                          | `x-request-id`  | Header the inbound **trace id** is adopted from, case-insensitive. See [Correlating with your logs](#correlating-with-your-logs).                                                                                                                                                           |
| `attachTraceIdToLogs`   | `boolean`                                                                         | `true`          | Prefix the application's own log output with the current trace id, so a line in a terminal or an aggregator leads back to its profile. Applies to loggers wrapped with `createProfilerLogger`.                                                                                              |

The storage-related options (`storageType`, `storagePath`, `storage`, `maxProfiles`, `ttl`) are detailed on the [Storage backends](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/storage) page.

## Correlating with your logs

A profile carries **two** identifiers, and they are deliberately different things:

|                     | `token`                                          | `traceId`                                         |
| ------------------- | ------------------------------------------------ | ------------------------------------------------- |
| Where it comes from | an internal UUID, never influenced by the caller | the inbound `traceIdHeader`, or generated         |
| What it addresses   | the profile's page, `/_profiler/:token`          | nothing — it is a label                           |
| Who sees it         | the UI and the `X-Debug-Token` headers           | your log lines, the profiles list, outgoing calls |

The token can never be caller-supplied: one that was could be forged to collide with — or traverse
— storage. The trace id has no such duty, so it _is_ allowed to come from outside, which is what
lets an upstream service and this one file the same request under the same id.

With `attachTraceIdToLogs` on (the default), a logger wrapped with `createProfilerLogger` prefixes
every forwarded line with it:

```
[3f2a91c4-...] Fetching articles from external API (MISS)
```

Paste that id into the profiler's search box and you land on the profile that produced the line.
The entry stored _inside_ the profile keeps the original message — repeating the id on every line
of a profile that has exactly one would be noise. Only a string message is prefixed: a structured
logger takes an object as its first argument, and splicing an id into one would either be dropped
or corrupt the payload.

Point `traceIdHeader` at whatever your edge already sets:

```ts
ProfilerModule.forRoot({ traceIdHeader: 'x-correlation-id' });
```

An inbound value is adopted only when it is at most 128 characters of `A-Z a-z 0-9 . _ ~ -` —
the alphabet shared by UUIDs, ULIDs and `traceparent`. Anything else is silently replaced by a
generated UUID. That check is not cosmetic: the trace id is printed into your logs, rendered in the
dashboard and echoed on outgoing requests, so an unvalidated one would be a log-injection
primitive, a stored-XSS candidate and a header-splitting vector at once.

Extracting an id out of a composite format (a W3C `traceparent`) is deliberately not built in:
parsing a format the profiler does not propagate end to end would suggest an interoperability it
does not provide. Normalize it at your edge instead.

Beyond the profile, each log line also records the **span** that was open when it was written, so
the trace shows a line at its place in the tree rather than in a flat list beside it.

## Timezone of displayed timestamps

Profiles store epoch milliseconds and every page is rendered **server-side**, so timestamps are displayed in the timezone the process runs in — the one Node resolves from the `TZ` environment variable, or the system zone when `TZ` is unset, and the one the Config panel reports. That is what you want in local development, where the application and the browser share a machine, and misleading as soon as they do not: an application running in a `TZ=UTC` container shows UTC times to someone reading the dashboard from Paris.

Set `timezone` to the zone the people reading the profiler are in:

```ts
ProfilerModule.forRoot({
  timezone: 'Europe/Paris', // default: the timezone the process runs in
});
```

It takes any IANA name the runtime knows (`Europe/Paris`, `UTC`, `America/New_York`…); an unknown name is ignored, a warning is logged and the host timezone is used. The option only affects rendering — stored profiles keep their epoch timestamps, and the JSON export is unchanged. Whatever the effective zone, it is displayed in the dashboard header (_Times in Europe/Paris_), so a time on screen is never ambiguous.

Nothing to declare when the container and the reader already agree, either because the application runs on the reader's machine or because the container carries the right `TZ`. Setting `TZ` moves the whole process — logs, `Date`, scheduled jobs — while `timezone` moves the profiler UI alone; reach for `TZ` when you want them to match, and for `timezone` when you only want to read the dashboard in your own time.

## Capturing full bodies

Captured bodies pass through two independent truncation layers. `maxBodySize` is the outer size cap: once the serialized body exceeds it, the whole body is replaced by a small placeholder. `bodyCaptureLimits` are the inner content caps, applied **first**, and they bound the body regardless of `maxBodySize`:

- `maxStringLength` (default `2048`) — strings longer than this are truncated with `… [truncated]`.
- `maxItems` (default `64`) — arrays, objects, `Map` and `Set` are capped, with a `… +N more` marker.
- `maxDepth` (default `4`) — anything nested deeper collapses to `[Object]` / `[Array]`.

Each cap (including `maxBodySize`) is disabled individually with `0` (or a negative value). To keep a genuinely complete body you must disable **all** of them — disabling only `maxBodySize` still lets the inner caps cut the content:

```ts
ProfilerModule.forRoot({
  collectBody: true,
  maxBodySize: 0, // no outer size cap
  bodyCaptureLimits: { maxStringLength: 0, maxItems: 0, maxDepth: 0 }, // no inner caps
});
```

Truncation happens at capture time, before the profile is stored — the full body is never persisted separately. Disabling the caps therefore captures everything, at the cost of larger stored profiles and slower detail-page rendering for big payloads. Raise individual caps instead of disabling them all when you only need a bit more headroom.

## CPU and memory

Every profile carries what the process spent while it was open, alongside the duration:

- **`performance.cpu`** — `user`, `system` and `total` CPU milliseconds. Read against the duration, this is the one measurement that separates work that was _computing_ from work that was _waiting_: a ratio near 1 is CPU-bound, near 0 is I/O-bound, and a slow endpoint is fixed very differently in the two cases. The Performance tab shows the share and names it.
- **`performance.memory`** — `heapUsedAfter`, `rss` and the `heapDelta` / `rssDelta` over the request. The deltas are what a leak looks like: a request that grows the heap and never gives it back. They can be negative, when a collection during the window freed more than the request allocated.
- **`performance.eventLoop`** — how much of the request's window the loop spent active rather than idle. High utilization on a slow request means the thread was blocked, which is the one condition concurrency cannot hide.
- **`performance.gc`** — collections that ran during the request and what they cost. Reported only while `runtime` is enabled, since observing GC means keeping a `PerformanceObserver` alive.

These cost two syscalls per profile and need no configuration.

**One caveat, and it matters before you read a number:** they are process-wide deltas over the profile's window, not an isolated measurement of that one execution. Node runs a single thread, so under concurrent traffic a request's window overlaps its neighbours' and it is charged with what they spent too. That is the right trade for a tool used while driving requests one at a time — which is how a profiler is used — and the Performance tab says so where the numbers are.

### The Runtime view

The per-request figures say how much one execution cost. They cannot say whether the heap has been climbing all afternoon, whether the loop is being blocked, or whether a major collection runs every few seconds — a leak is a shape over time, not a value on one request. The **Runtime** view in the dashboard sidebar is that shape: memory, CPU, event-loop lag percentiles and GC by kind, sampled on an interval, plus the V8 heap spaces and the process facts.

```ts
ProfilerModule.forRoot({
  runtime: { interval: 5000, historySize: 120 }, // the defaults
});
```

Five seconds rather than a production agent's minute: a profiler is read while the thing it measures is still happening, and a minute-wide sample flattens the spike you opened the panel to look at. History is bounded, so a long-running process cannot grow it without limit.

Turn it off with `runtime: false`. That stops the interval, releases the event-loop histogram and the GC observer, and removes the view; per-request CPU and memory keep working, but per-profile `gc` is no longer reported since nothing is observing collections.

Everything it reads comes from `node:os`, `node:v8` and `node:perf_hooks` — there is no dependency to install and nothing leaves the process.

## Redacting sensitive data

A profile is a verbatim copy of a request, so anything credential-shaped that reaches one is readable for as long as the profile lives — in the dashboard, in the JSON export at `/_profiler/:token/data`, in the _Copy as cURL_ command, and on disk when `storageType: 'file'` or the SQLite adapter is used. Three capture paths are therefore masked **by default**, before anything is persisted:

- **Headers** — `authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `proxy-authorization`, on the request **and** the response: a captured `set-cookie` is a replayable session for as long as the profile lives.
- **Query parameters** — `token`, `access_token`, `refresh_token`, `id_token`, `api_key`, `code`, `state`, `signature`, `sig`, `password`, `secret`, `client_secret`, `session_id`… matched case-insensitively and ignoring `-`/`_`, so `access_token`, `accessToken` and `Access-Token` are one entry.
- **Bodies (request and response, under `collectBody`), session data and collector payloads** — object keys matching a sensitive-key pattern, plus credentials embedded in string values (JWTs, PEM blocks, `sk-`/`pk-` keys, `scheme://user:pass@host` userinfo, Luhn-valid card numbers). Bodies are masked **after** the `bodyCaptureLimits` / `maxBodySize` caps, so masking only walks what actually reaches the profile.

Every list is **additive**: naming your own entries extends the built-ins rather than replacing them, so adding one header can never silently stop `authorization` from being masked. Configure them all through a single `redaction` block:

```ts
ProfilerModule.forRoot({
  redaction: {
    headers: ['x-tenant-token'], // masked in addition to the six built-ins
    cookies: ['sid'],
    queryParams: ['inviteRef'], // masked in addition to the built-in list
    keys: ['internalToken'], // object keys in bodies, session data and collector payloads
    patterns: [/acct_[a-z0-9]{16}/gi], // extra value patterns (alongside JWT/PEM/API-key/card detection)
    replacement: '[REDACTED]', // customize the sentinel written in place of a masked value
  },
});
```

Parameter and header **names are kept** and only their values replaced, so a captured URL still reads `?token=[REDACTED]`: knowing that a request carried a token is useful when reading a trace, knowing which one is not.

Only names are inspected for headers/query parameters/keys — never values. A pattern hunting for token-shaped strings anywhere in a URL mangles ordinary ids and path segments, and a redactor that mangles real data is one somebody switches off. `patterns` is the deliberate exception: it scans string _values_ for a shape you name, the same way the built-in JWT/PEM/API-key detectors do. String values are also checked against a Luhn-validated card-number pattern, so a 13-19 digit run is only masked when it passes the checksum — an ordinary numeric id of the same length is left alone.

To take masking over entirely, opt out of every built-in list at once — the header, query-parameter **and** sensitive-key lists all go together. The built-in value detectors (JWT, PEM, `sk-` keys, userinfo, card numbers) are not a list you can restate name by name, and stay on:

```ts
ProfilerModule.forRoot({
  redaction: {
    useDefaults: false,
    headers: ['authorization', 'x-tenant-token'],
  },
});
```

Two limits worth stating plainly. Redaction is a safety net for credentials that reach a request by design, not a guarantee that none can be captured: a secret carried in a path segment (`/reset/<token>`), in a parameter name nothing here matches, or inside a body under an unrecognised key still lands in the profile. And `ignoreRequest` deliberately sees the **unredacted** request — it decides what gets profiled at all, so it must see what actually arrived. On any environment that is not a developer's own machine, treat the dashboard itself as the boundary and lock it down with [`security`](#securing-the-ui).

## The exception stack

Every captured exception carries its stack as **parsed frames** rather than as one opaque string, and the Exceptions tab renders them in the shape a stack is actually read: the throw site first, with the source around it; the rest of the application frames one click away; everything below the application — dependencies and Node internals — collapsed into a single count you open only when you need it. The `cause` chain gets the same treatment, at every level.

Parsing costs no I/O and always happens. What `sourceContext` controls is the source excerpt around each application frame — the Symfony exception page, locally. Nothing leaves the machine: the file is read straight off disk and stored on the profile like everything else.

```ts
ProfilerModule.forRoot({
  sourceContext: true, // the default — `{ linesOfContext: 5, maxFrames: 5 }` to tune it
  projectRoot: process.cwd(), // the default
});
```

Set `sourceContext: false` to keep the grouped frames without ever reading a file, and `projectRoot` when the process does not start from the application root (a monorepo launched from the repo root, say) — it is what tells an application frame from a dependency, and it is the directory display paths are relative to.

Both apply to every captured exception, whichever entrypoint raised it — an HTTP request, a CLI command, a consumed message — and to errors the application caught itself and reported through [`TracerService.captureError()`](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/collectors), which the tab marks `Handled` rather than colouring as a failure.

Only application frames are ever read: a frame is opened when it resolves **under `projectRoot`** with a recognised source extension (`.js`, `.ts`, `.mjs`…), and not otherwise. `Error#stack` is not a trusted input — a message an attacker influences can inject text that parses like a stack frame — so without this pair of guards, a forged stack could read an arbitrary file off the host. File reads are cached (failures too), bounded to 200 files, and never throw: a missing source excerpt never breaks a request that already failed. Frames are capped at 50 per exception so a runaway recursion cannot flood storage.

Source maps are not resolved by the profiler — run Node with `--enable-source-maps` and `Error.stack` already carries original-source positions, so there is nothing extra to do.

### What an exception says about itself

Beyond the class, the message and the `cause` chain, an exception carries the **response payload** its `HttpException` answered with (`getResponse()`), under `ExceptionEntry.details`. That matters most for a rejected DTO: `HttpException#message` for a `BadRequestException(violations)` is the generic class message — literally `"Bad Request Exception"` — and the field errors live only in the payload. So the tab shows the payload's message lines _instead of_ the exception's own whenever they differ, and renders whatever else the payload carried under **Response payload**.

The payload is bounded and masked exactly like a captured body (`maxBodySize`, `bodyCaptureLimits`, `redaction`), but `collectBody` does not gate it: it is the error the caller was already told about, not something harvested from the request. Nothing is stored when the payload only restates the exception — `statusCode` is already the profile's status and `error` restates the class name.

A validation failure also throws entirely inside the framework, so its stack holds no application frame at all. Rather than promote a `@nestjs/common` frame to the throw site — the one line you can do nothing about — the tab names it on a single line and leaves every frame collapsed.

## Opening a frame in your editor

Set `editor` and every source location in the Exceptions tab becomes a link that opens the file at the right line:

```ts
ProfilerModule.forRoot({
  editor: 'vscode',
});
```

Known names: `vscode`, `vscode-insiders`, `cursor`, `windsurf`, `zed`, `webstorm`, `idea`, `phpstorm`, `sublime`, `textmate`. Anything else is treated as a URL template carrying `%f` (the absolute path) and `%l` (the line), so an editor that is not on the list still works:

```ts
ProfilerModule.forRoot({
  editor: 'myeditor://open?file=%f&line=%l',
});
```

Only frames that resolved to an absolute path under `projectRoot` are linked — a dependency frame has no file on the reader's machine worth pointing at. Unset (the default), locations render as plain text; an unrecognised name logs a warning at startup and does the same. The link is a URL the **reader's** browser hands to the **reader's** machine, so it is only useful while the dashboard is read where the code lives.

## Custom indexed attributes

`attributes` attaches custom facets to a profile — the equivalent of a tag/attribute set on an APM span — merged into the same projection that already carries the built-in `exception` facet, and queryable the same way (`attributes.<key>`) through the storage API.

```ts
ProfilerModule.forRoot({
  attributes: (req) => ({ tenant: req.headers['x-tenant-id'] as string }),
});
```

Pass a **plain object** to attach the same facets to every profile regardless of entrypoint kind (`{ env: process.env.NODE_ENV }`), computed once at startup. Pass a **function** to derive facets per HTTP request — only HTTP profiles get these, since a request is only available at that capture point (the same limitation `requestId` has today).

A custom attribute does not gain a list-page filter row automatically — register your own list filter (contributed via the `PROFILER_LIST_FILTERS` multi-token) pointing at `attributes.<key>` to expose it as one, the same way the built-in `exception` filter targets `attributes.exception`.

## Forcing capture past sampling

`sampleRate` below `1.0` means losing exactly the requests you might want to see. `alwaysProfile` is evaluated **before** the sample-rate roll, so it can force-capture a specific request regardless of it — but it cannot resurrect a request `ignoreRequest`/`ignorePaths` already excluded; those remain a hard "never profile this".

```ts
ProfilerModule.forRoot({
  sampleRate: 0.1,
  alwaysProfile: (req) => req.headers['x-profiler'] === '1',
});
```

One corollary worth knowing: sampling cannot "keep every error" — the decision is made before the response status is known. That is a structural limit, not a bug, but it surprises people the first time a 500 goes unprofiled on a sampled environment.

## Debugging why a request wasn't profiled

`debug: true` traces the skip decision via `Logger.debug` — the profiler's own route, `ignoreRequest`, `ignorePaths` (with the matched entry), or the `sampleRate` roll. Off by default so it costs nothing in the common case: the reason is only built once the option is on.

```ts
ProfilerModule.forRoot({ debug: true });
```

## What counts as an error

`error` defines what a **failed request** is for the built-in `http` kind. By default that is a 5xx status, or a captured exception when no status was recorded — a `401`/`403`/`404` means your application answered correctly, so it is not an error:

```ts
ProfilerModule.forRoot({ error: { httpStatus: 400 } }); // count 4xx too
```

This governs the `http` kind only. Every other entrypoint kind carries its own definition, configured on its own package (`GraphQLCollectorModule`, `RabbitMqCollectorModule`), since a status code means nothing to them — and outgoing HTTP calls are judged separately via `HttpCollectorModule`. The full picture, including the `Exception` filter and custom kinds, is on the [What counts as an error](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/error-classification) page.

## Versioning and global prefix

The profiler is tooling, not part of your API surface, so **your app's routing never applies to it**. The UI is always at `/_profiler`, and you have nothing to declare for that to hold.

**API versioning** is ignored — the controller is `VERSION_NEUTRAL`, so no scheme (URI, header or media-type) prefixes it:

```ts
app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
// your routes  -> /v1/orders
// the profiler -> /_profiler
```

A **global prefix** is ignored too. The profiler opts itself out of `setGlobalPrefix()`, so it stays at the root while your own routes get prefixed as usual:

```ts
app.setGlobalPrefix('api/v1');
// your routes  -> /api/v1/orders
// the profiler -> /_profiler
```

Listing `_profiler` in `exclude` yourself is therefore unnecessary — though harmless if you do, the profiler will not add a second entry.

> **Watch out:** `exclude` does more than skip the prefix — it also determines which routes the profiler's middleware binds to. A route served outside Nest's router (a GraphQL endpoint handled by Apollo, say) must be listed there, otherwise the middleware never runs for it and its operations drop out of the profiler:
>
> ```ts
> app.setGlobalPrefix('api/v1', {
>   exclude: [{ path: 'graphql', method: RequestMethod.ALL }],
> });
> ```

## Securing the UI

The profiler ships **open** — no authentication by default (intended for local development). To lock `/_profiler/*` down, provide your own strategy through the `security` option. You bring the authentication; the profiler just enforces it. Two building blocks, usable alone or together (when both are set, **all must pass**):

- `authorize` — a predicate `(ctx) => boolean | Promise<boolean>` deciding access. `ctx.request` and `ctx.response` are the platform-agnostic Express/Fastify surfaces. Return `false` to deny (the guard throws `401`).
- `guards` — one or more NestJS `CanActivate` guards (a class resolved through DI, so you can reuse an existing app guard, or a ready instance).

Static assets under `/_profiler/__assets/*` are always exempt so the UI's CSS/JS load even behind auth.

### Token (bearer, for API/CLI clients)

```ts title="app.module.ts"
ProfilerModule.forRoot({
  security: {
    authorize: ({ request }) =>
      request.headers['authorization'] === `Bearer ${process.env.PROFILER_TOKEN}`,
  },
});
```

```bash
curl -H "Authorization: Bearer your-secret-token" http://localhost:3000/_profiler
```

### Basic auth (browser challenge)

Set a `WWW-Authenticate` header before denying so the browser prompts for credentials:

```ts
security: {
  authorize: ({ request, response }) => {
    const header = request.headers['authorization'] ?? '';
    const [user, pass] = Buffer.from(header.replace('Basic ', ''), 'base64').toString().split(':');
    if (user === 'admin' && pass === process.env.PROFILER_PASSWORD) return true;
    response.setHeader('WWW-Authenticate', 'Basic realm="Profiler"');
    return false;
  },
}
```

### Cookie / session

The browser sends cookies and sessions automatically on every request, so this works across all UI navigation with nothing else to wire:

```ts
security: {
  authorize: ({ request }) => Boolean(request.session?.isAdmin),
}
```

### Reuse a NestJS guard (with DI)

Resolve services through `forRootAsync`, or hand the profiler an existing guard class:

```ts
ProfilerModule.forRoot({ security: { guards: [JwtAuthGuard, AdminGuard] } });

// or inject services into the decision:
ProfilerModule.forRootAsync({
  inject: [AuthService],
  useFactory: (auth: AuthService) => ({
    security: { authorize: ({ request }) => auth.isProfilerAdmin(request) },
  }),
});
```

### Browser navigation & `linkQuery`

The UI is navigated through plain `<a>` links. A browser only attaches the credentials it holds itself — **cookies, sessions and HTTP Basic auth** — so those schemes propagate to every page (including the `/:token/data` JSON export) with no extra work. A bare `Authorization` header or a `?token=` query cannot ride a link click: header auth therefore suits API/CLI clients (curl), while a query-param scheme needs `linkQuery` to thread the credential through the UI's links:

```ts
security: {
  authorize: ({ request }) => request.query?.token === process.env.PROFILER_TOKEN,
  linkQuery: (request) => (request.query?.token ? `?token=${request.query.token}` : ''),
}
```

### See it in action

The [example app's `resolveProfilerSecurity`](https://github.com/eleven-labs/nest-profiler/blob/main/examples/api/src/profiling/profiling.module.ts) wires every seam side by side, selected by a `PROFILER_AUTH` env var (`basic`, `token`, `cookie`) exactly like its `SQL_ORM` adapter switch — off by default. `cookie` reuses a NestJS guard through `security.guards` and reads the JWT from a cookie, so it stays browser-navigable while also accepting a Bearer header for API clients.
