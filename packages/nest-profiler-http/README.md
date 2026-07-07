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

`@eleven-labs/nest-profiler-http` captures outgoing HTTP requests and displays them in a dedicated **HTTP Client** panel. It is **client-agnostic**: it owns the `HttpRequestEntry` contract, the collector, the `HttpProfilerRecorder` and an `HttpInstrumentation` interface, and never depends on any HTTP-client library. It ships two opt-in, subpath-isolated adapters — **axios** and **fetch** — that both capture request and response bodies safely, and you pick exactly which client(s) to instrument. Nothing is patched unless you select it, and you can bring your own client the same way.

![HTTP Client panel — outgoing requests with method, URL, status and duration](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/http-client.png)

## Installation

```bash
pnpm add @eleven-labs/nest-profiler-http
# only if you select the axios adapter — your app already owns these:
pnpm add @nestjs/axios axios
```

**Optional peer dependency:** `axios ^1.0.0` (type-only, used by the `/axios` adapter). `fetch` is a Node ≥ 22 built-in and needs no dependency. This package never imports `@nestjs/axios` — that is your application's dependency.

## Selecting clients

Import each adapter from its own subpath and list it in `instrumentations`. **Nothing is instrumented unless it appears in the list.**

```ts title="app.module.ts"
import { ConditionalModule } from '@nestjs/config';
import { HttpCollectorModule } from '@eleven-labs/nest-profiler-http';
import { AxiosInstrumentation } from '@eleven-labs/nest-profiler-http/axios';
import { FetchInstrumentation } from '@eleven-labs/nest-profiler-http/fetch';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] === 'true';

@Module({
  imports: [
    ConditionalModule.registerWhen(
      HttpCollectorModule.forRoot({
        instrumentations: [AxiosInstrumentation, FetchInstrumentation],
        captureResponseBody: true,
      }),
      isProfilerEnabled,
    ),
  ],
})
export class AppModule {}
```

Each adapter lives on its own subpath (`/axios`, `/fetch`), so importing one never loads another's dependency. The root barrel exports only the client-agnostic API.

> **Enabling / disabling** — gate the collector with `ConditionalModule.registerWhen(..., isProfilerEnabled)` as shown, so it loads only when `PROFILER_ENABLED` is on. Wire the core `ProfilerModule` and its `ProfilerNoopModule` fallback **once at the root** — the recommended setup bundles the root-level profiler modules into a single `ProfilingModule` behind two `ConditionalModule` gates (see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#enabling-and-disabling-the-profiler) and the [example app](https://nest-profiler.eleven-labs.com/docs/example-api)). A top-level `enabled` option is also supported as an alternative.

### How each adapter finds requests

- **`AxiosInstrumentation`** (`/axios`) — **auto-discovers** every axios instance in the DI container via `DiscoveryService`: `@nestjs/axios` `HttpService` (including each per-feature `HttpModule` / `HttpModule.register()`, which build distinct instances) and bare axios instances provided directly. No `axiosRef` wiring, no `@nestjs/axios` import. Just inject `HttpService` in your services as usual — requests are captured automatically. Axios instances created outside DI (a bare `axios.create()` held in a private field, a third-party library's internal client) aren't discoverable — record those with a custom instrumentation (below).
- **`FetchInstrumentation`** (`/fetch`) — patches `globalThis.fetch` once. A single global hook covers every caller.

> **Other clients (got, undici, superagent…)?** There is no `node:http` catch-all: instrument them with a small custom `HttpInstrumentation` using the client's own hooks (see [Bring your own HTTP client](#bring-your-own-http-client)). Going through the client's native API captures full request **and** response bodies safely — which a generic `node:http` hook cannot do for response bodies.

## Bring your own HTTP client

For an ad-hoc call, inject `HttpProfilerRecorder` and call `capture()` — it applies your capture options (headers/body) and masks sensitive headers, so a custom client shows the same detail in the panel:

```ts
import { HttpProfilerRecorder } from '@eleven-labs/nest-profiler-http';

@Injectable()
export class WeatherService {
  constructor(private readonly recorder: HttpProfilerRecorder) {}

  async getForecast() {
    const url = 'https://api.weather.example.com/forecast';
    const startedAt = Date.now();
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    const body = await res.json();

    this.recorder.capture({
      method: 'GET',
      url,
      startedAt,
      duration: Date.now() - startedAt,
      statusCode: res.status,
      responseHeaders: res.headers, // fetch `Headers` (and `Map`) are supported
      responseBody: body,
    });

    return body;
  }
}
```

For a **reusable** integration, implement `HttpInstrumentation` — a NestJS provider with `install(recorder)` — and add it to `instrumentations`. It can inject `ModuleRef`, config, etc. This is exactly how the bundled adapters work. Example, instrumenting [`got`](https://github.com/sindresorhus/got):

```ts
import { Injectable } from '@nestjs/common';
import type { HttpInstrumentation, HttpProfilerRecorder } from '@eleven-labs/nest-profiler-http';
import got from 'got';

@Injectable()
export class GotInstrumentation implements HttpInstrumentation {
  install(recorder: HttpProfilerRecorder): void {
    got.extend({
      hooks: {
        beforeRequest: [
          (options) => {
            (options as { _start?: number })._start = Date.now();
          },
        ],
        afterResponse: [
          (response) => {
            const started = (response.request.options as { _start?: number })._start ?? Date.now();
            recorder.capture({
              method: response.request.options.method,
              url: response.requestUrl.toString(),
              startedAt: started,
              duration: Date.now() - started,
              statusCode: response.statusCode,
              responseHeaders: response.headers,
              responseBody: response.body,
            });
            return response;
          },
        ],
      },
    });
  }
}

// HttpCollectorModule.forRoot({ instrumentations: [GotInstrumentation] });
```

Use `record(entry)` instead of `capture(input)` if you have already built a final `HttpRequestEntry` and want to bypass the capture options. The example API swaps its whole `ArticleGateway` between the axios and fetch adapters with `HTTP_CLIENT=axios|fetch` — run it with `HTTP_CLIENT=fetch` to see the fetch adapter capturing the same calls.

## Options

`HttpCollectorModule.forRoot(options)` accepts:

| Option                   | Default | Description                                                                                                         |
| ------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `instrumentations`       | `[]`    | The adapters to install (`AxiosInstrumentation`, `FetchInstrumentation`, …). Nothing is instrumented unless listed. |
| `captureRequestHeaders`  | `true`  | Capture (and mask) outgoing request headers.                                                                        |
| `captureRequestBody`     | `false` | Capture request body for non-GET/HEAD requests.                                                                     |
| `captureResponseHeaders` | `true`  | Capture (and mask) response headers.                                                                                |
| `captureResponseBody`    | `false` | Capture response body — can be large.                                                                               |
| `maskHeaders`            | `[]`    | Extra header names to redact (merged with the defaults).                                                            |

## What it collects

For each outgoing request: `method`, `url`, `statusCode`, `duration`, `startedAt`, optional `error`, and (per options) request/response headers and bodies.

## Toolbar badge

Request count (e.g. `3`). When errors are present: `3 (1 err)`.

## Panel behaviour

The HTTP Client panel lets you expand each row to inspect request/response headers and bodies. That behaviour ships as a compiled, same-origin browser bundle (`http.js`) that the module registers with the profiler automatically — there is nothing to configure, and the templates carry no inline JavaScript. It is a reference implementation of the [Extending the UI with JavaScript](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/extending-the-ui) pattern, reusing the core `window.NestProfiler` runtime.

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
