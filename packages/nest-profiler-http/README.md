# @eleven-labs/nest-profiler-http

<p align="center">
  <a href="https://eleven-labs.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/assets/eleven-labs-white.svg">
      <img alt="Powered &amp; maintained by Eleven Labs" src="https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/assets/eleven-labs-dark.svg" width="180">
    </picture>
  </a>
</p>

<p align="center"><em>Powered &amp; maintained by <a href="https://eleven-labs.com">Eleven Labs</a></em></p>

<p align="center">
  <a href="https://github.com/eleven-labs/nest-profiler/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/eleven-labs/nest-profiler/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/eleven-labs/nest-profiler/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/eleven-labs/nest-profiler/actions/workflows/quality.yml/badge.svg" /></a>
  <a href="https://codecov.io/gh/eleven-labs/nest-profiler/flags"><img alt="Coverage" src="https://codecov.io/gh/eleven-labs/nest-profiler/branch/main/graph/badge.svg?flag=nest-profiler-http" /></a>
  <a href="https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-http"><img alt="Documentation" src="https://img.shields.io/badge/docs-nest--profiler.eleven--labs.com-e5225a" /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a" />
  <img alt="Built with NestJS" src="https://img.shields.io/badge/built%20with-NestJS-ea2845" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Code style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" />
</p>

`@eleven-labs/nest-profiler-http` captures outgoing HTTP requests and displays them in a dedicated **HTTP Client** panel. It is **client-agnostic**: it owns the `HttpRequestEntry` contract, the collector, the `HttpProfilerRecorder` and an `HttpInstrumentation` interface. An **axios adapter** is bundled and enabled by default; fetch, undici, got or any custom client can feed the same panel.

![HTTP Client panel — outgoing requests with method, URL, status and duration](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/http-client.png)

## Installation

```bash
pnpm add @eleven-labs/nest-profiler-http
# for the bundled axios adapter (optional):
pnpm add @nestjs/axios axios
```

**Optional peer dependencies:** `axios ^1.0.0`, `@nestjs/axios ^4.0.0` — only needed for the axios adapter.

## Setup (axios, default)

Import `HttpCollectorModule` to register the panel. The axios adapter is on by default and patches the `HttpService` provided by `@nestjs/axios`'s `HttpModule` in the same module:

```ts title="app.module.ts"
import { ConditionalModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { HttpCollectorModule } from '@eleven-labs/nest-profiler-http';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] !== 'false';

@Module({
  imports: [
    HttpModule, // provides HttpService — required for the axios adapter
    ConditionalModule.registerWhen(HttpCollectorModule.forRoot(), isProfilerEnabled),
  ],
})
export class AppModule {}
```

> **Enabling / disabling** — gate the collector with `ConditionalModule.registerWhen(..., isProfilerEnabled)` as shown, so it loads only when `PROFILER_ENABLED` is on. Wire the core `ProfilerModule` and its `ProfilerNoopModule` fallback **once at the root** — the recommended setup bundles the root-level profiler modules into a single `ProfilingModule` behind two `ConditionalModule` gates (see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#enabling-and-disabling-the-profiler) and the [example app](https://nest-profiler.eleven-labs.com/docs/example-api)). A top-level `enabled` option is also supported as an alternative.

Inject `HttpService` in your services as usual — requests are captured automatically.

## Bring your own HTTP client

No axios? Inject `HttpProfilerRecorder` and call `capture()` from any client. `capture()` applies your capture options (request/response headers + body) and masks sensitive headers for you — so a custom client shows the same request/response detail in the panel as axios:

```ts
import { HttpProfilerRecorder } from '@eleven-labs/nest-profiler-http';

@Injectable()
export class WeatherService {
  constructor(private readonly http: HttpProfilerRecorder) {}

  async getForecast() {
    const url = 'https://api.weather.example.com/forecast';
    const requestHeaders = { accept: 'application/json' };

    const startedAt = Date.now();
    const res = await fetch(url, { headers: requestHeaders });
    const body = await res.json();

    this.http.capture({
      method: 'GET',
      url,
      startedAt,
      duration: Date.now() - startedAt,
      statusCode: res.status,
      requestHeaders,
      responseHeaders: res.headers, // fetch `Headers` (and `Map`) are supported
      responseBody: body,
    });

    return body;
  }
}
```

`capture()` honours the configured `captureRequestHeaders` / `captureRequestBody` / `captureResponseHeaders` / `captureResponseBody` flags and the `maskHeaders` list. Use `record(entry)` instead if you have already built a final `HttpRequestEntry` and want to bypass the options. A runnable version lives in the example API at `GET /posts/via-fetch`.

For a reusable integration, implement `HttpInstrumentation` (`install(recorder)`) and register it via `HttpCollectorModule.forRoot({ instrumentations: [MyInstrumentation] })` — that is exactly how the bundled axios adapter works.

## Options

`HttpCollectorModule.forRoot(options)` accepts:

| Option                   | Default | Description                                              |
| ------------------------ | ------- | -------------------------------------------------------- |
| `axios`                  | `true`  | Enable the bundled axios adapter (no-op without axios).  |
| `instrumentations`       | `[]`    | Custom `HttpInstrumentation` providers to install.       |
| `captureRequestHeaders`  | `true`  | Capture (and mask) outgoing request headers.             |
| `captureRequestBody`     | `true`  | Capture request body for non-GET/HEAD requests.          |
| `captureResponseHeaders` | `true`  | Capture (and mask) response headers.                     |
| `captureResponseBody`    | `false` | Capture response body (can be large).                    |
| `maskHeaders`            | `[]`    | Extra header names to redact (merged with the defaults). |

## What it collects

For each outgoing request: `method`, `url`, `statusCode`, `duration`, `startedAt`, optional `error`, and (per options) request/response headers and bodies.

## Toolbar badge

Request count (e.g. `3`). When errors are present: `3 (1 err)`.

## Panel behaviour

The HTTP Client panel lets you expand each row to inspect request/response headers and bodies. That behaviour ships as a compiled, same-origin browser bundle (`http.js`) that the module registers with the profiler automatically — there is nothing to configure, and the templates carry no inline JavaScript. It is a reference implementation of the [Extending the UI with JavaScript](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/extending-the-ui) pattern, reusing the core `window.NestProfiler` runtime.

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
