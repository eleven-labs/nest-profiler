# HTTP client collector — `@eleven-labs/nest-profiler-http`

Profiles outbound HTTP calls and tags them `slow` / `n-plus-one` / `chatty` / `large-payload`.

- **Peers:** `nestjs-cls@^6` (required); `axios@^1` **optional** (only if you use the axios instrumentation).
- **Module:** `HttpCollectorModule` (`forRoot` + `forRootAsync`).
- **Placement:** the feature module that owns the HTTP client. For axios, `@nestjs/axios`'s `HttpModule` must be imported in the **same** module.
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-http> · tutorial: <https://nest-profiler.eleven-labs.com/docs/tutorials/http-collector>

## ⚠️ Central gotcha: nothing is captured without an instrumentation

`HttpCollectorModule` is "bring your own client". **Nothing is instrumented unless you list an instrumentation** in `instrumentations`:

- **axios** → `import { AxiosInstrumentation } from '@eleven-labs/nest-profiler-http/axios';` — auto-discovers the `@nestjs/axios` `HttpService`, so calls are captured with no per-instance wiring. `HttpModule` must be imported alongside.
- **native `fetch`** → `import { FetchInstrumentation } from '@eleven-labs/nest-profiler-http/fetch';` — patches `globalThis.fetch`; needs no HTTP-client dependency.
- **undici / got / other** → inject `HttpProfilerRecorder` and call `.capture({...})` at the call site, or implement `HttpInstrumentation` and pass it via `instrumentations`.

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

```ts title="axios adapter module"
import { HttpModule } from '@nestjs/axios';
import { HttpCollectorModule } from '@eleven-labs/nest-profiler-http';
import { AxiosInstrumentation } from '@eleven-labs/nest-profiler-http/axios';

@Module({
  imports: [
    HttpModule,
    ConditionalModule.registerWhen(
      HttpCollectorModule.forRoot({ instrumentations: [AxiosInstrumentation] }),
      isProfilerEnabled,
    ),
  ],
})
export class HttpClientModule {}
```

```ts title="native fetch"
import { HttpCollectorModule } from '@eleven-labs/nest-profiler-http';
import { FetchInstrumentation } from '@eleven-labs/nest-profiler-http/fetch';

ConditionalModule.registerWhen(
  HttpCollectorModule.forRoot({ instrumentations: [FetchInstrumentation] }),
  isProfilerEnabled,
),
```
