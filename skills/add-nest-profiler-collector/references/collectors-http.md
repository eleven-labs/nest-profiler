# HTTP client collector — `@eleven-labs/nest-profiler-http`

Profiles outbound HTTP calls and tags them `slow` / `n-plus-one` / `chatty` / `large-payload`.

- **Peers:** `nestjs-cls@^6` (required); `axios@^1` **optional** (only if you use the axios instrumentation).
- **Module:** `HttpCollectorModule` (`forRoot` + `forRootAsync`).
- **Placement:** the `ProfilingModule` bundle. The app keeps importing `@nestjs/axios`'s `HttpModule` wherever it injects `HttpService`; `AxiosInstrumentation` discovers every instance across the app.
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-http> · tutorial: <https://nest-profiler.eleven-labs.com/docs/tutorials/http-collector>

## ⚠️ Central gotcha: nothing is captured without an instrumentation

`HttpCollectorModule` is "bring your own client". **Nothing is instrumented unless you list an instrumentation** in `instrumentations`:

- **axios** → `import { AxiosInstrumentation } from '@eleven-labs/nest-profiler-http/axios';` — auto-discovers every `@nestjs/axios` `HttpService` (via `DiscoveryService`), so calls are captured with no per-instance wiring.
- **native `fetch`** → `import { FetchInstrumentation } from '@eleven-labs/nest-profiler-http/fetch';` — patches `globalThis.fetch`; needs no HTTP-client dependency.
- **undici / got / other** → implement `HttpInstrumentation` and pass it via `instrumentations` (it lives in the bundle, so it suits the dev-dependency install). Injecting `HttpProfilerRecorder` and calling `.capture({...})` at the call site puts profiler code in the app — `ConditionalModule` install only, and `HttpCollectorModule` must then be visible to that module (it is not global).

**Key questions to ask:** (1) which client(s) to instrument — axios, fetch, or both? (2) capture request/response bodies?

## Options

| Option                | Type       | Default   | Notes                                                                                                    |
| --------------------- | ---------- | --------- | -------------------------------------------------------------------------------------------------------- |
| `enabled`             | `boolean`  | `true`    | Synchronous.                                                                                             |
| `instrumentations`    | `Type[]`   | `[]`      | HTTP clients to instrument. **Empty ⇒ nothing captured.**                                                |
| `captureRequestBody`  | `boolean`  | `false`   | sensitive.                                                                                               |
| `captureResponseBody` | `boolean`  | `false`   | sensitive.                                                                                               |
| `maskHeaders`         | `string[]` | built-ins | merged with `authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `proxy-authorization`. |

**Rarely tuned at wiring time** — the performance thresholds (`slowThreshold` 300 ms, `nPlusOneThreshold` 2, `chattyThreshold` 10, `largePayloadThreshold` 1 MB) and the header-capture flags (`captureRequestHeaders` / `captureResponseHeaders`, both `true`). See the [package docs](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-http) and the `interpret-performance-tags` skill for the thresholds.

## Snippets

```ts title="profiling/profiling.module.ts — axios and/or fetch"
import { HttpCollectorModule } from '@eleven-labs/nest-profiler-http';
import { AxiosInstrumentation } from '@eleven-labs/nest-profiler-http/axios';
import { FetchInstrumentation } from '@eleven-labs/nest-profiler-http/fetch';

// in ProfilingModule's imports (the app keeps HttpModule in its own feature modules):
HttpCollectorModule.forRoot({ instrumentations: [AxiosInstrumentation, FetchInstrumentation] }),
```
