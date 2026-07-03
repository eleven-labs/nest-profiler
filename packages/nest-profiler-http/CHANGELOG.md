# @eleven-labs/nest-profiler-http

## 1.0.0-alpha.7

### Patch Changes

- e5464e6: Ship the profiler UI's browser behaviour as compiled, same-origin JavaScript bundles instead of inline template scripts, and make the client layer extensible.

  - All authored client behaviour (theme toggle, syntax highlighting, copy-to-clipboard, filter forms, tab switching) now lives in TypeScript, is bundled at build time, and is served under `/_profiler/__assets/scripts/*`. The HTML templates carry no inline `<script>` blocks and no `on*` attributes, so a strict `script-src 'self'` Content-Security-Policy works out of the box.
  - New `window.NestProfiler` browser runtime (`onReady`, `delegate`, `copyText`, `highlight`) that other bundles reuse — the only cross-bundle contract.
  - New `ClientAssetRegistry` service (exported, with `CORE_CLIENT_SCRIPT` and the `ClientAssetRegistration` type): a package shipping its own collector can register a client bundle so the profiler serves it and injects its `<script>` after `profiler.js`.
  - `nest-profiler-http`: the HTTP Client panel's request-row expand/collapse behaviour moves out of inline template handlers into a compiled `http.js` bundle registered automatically via `ClientAssetRegistry` — a reference implementation of the pattern. No consumer-facing change.

## 1.0.0-alpha.6

### Minor Changes

- 8516122: Add Symfony-style "copy" buttons to the profiler UI so captured operations can be replayed in one click.

  - `nest-profiler`: copy the incoming HTTP request as a runnable `curl` command, and copy each SQL query with its bound parameters inlined (supports both `$N` Postgres/TypeORM and `?` MySQL/MikroORM placeholders). Exposes `buildCurlCommand` and `interpolateSql`.
  - `nest-profiler-http`: copy each outgoing HTTP client request as `curl`.
  - `nest-profiler-mongoose`: copy each query as a runnable `mongosh` command; aggregation pipelines are now captured so `aggregate` copies are complete.
  - `nest-profiler-rabbitmq`: copy the message payload and a ready-to-run amqplib `channel.publish(...)` snippet.

### Patch Changes

- d34fefe: Update supported peer dependency ranges and test dependencies for current NestJS 11-compatible releases, including `nestjs-cls` 6, Mongoose 9, and TypeORM 1.

## 1.0.0-alpha.5

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.4

### Major Changes

- 2b0e626: Make HTTP-client profiling client-agnostic and rename the axios package.

  BREAKING: `@eleven-labs/nest-profiler-axios` is renamed to `@eleven-labs/nest-profiler-http`, which is now client-agnostic. The old package is kept as a deprecated re-export shim and will be removed in a future release.
  - `@eleven-labs/nest-profiler-http` now owns the full HTTP-client contract: the `HttpRequestEntry` type, the `HttpClientCollector` + panel, the injectable `HttpProfilerRecorder`, the low-level `appendHttpRequestEntry(cls, entry)` helper, the redaction helpers (`DEFAULT_MASK_HEADERS` / `extractHeaders` / `formatHeaderValue`), and a pluggable `HttpInstrumentation` interface. The core `@eleven-labs/nest-profiler` is unchanged and stays HTTP-agnostic.
  - axios is now one **instrumentation** (`AxiosInstrumentation`) among others, enabled by default and no-op when `@nestjs/axios` is absent. Any client (fetch, undici, got, custom) feeds the same panel by injecting `HttpProfilerRecorder` or by registering a custom `HttpInstrumentation`.
  - The module is renamed `AxiosCollectorModule` → `HttpCollectorModule`; `forRoot()` accepts `axios`, `instrumentations` and the shared `HttpCaptureOptions`. `AxiosCollectorModule` remains exported from the deprecated shim as an alias.
  - The collector panel id / storage key is now `http-client` (was `axios`): stored data moves from `profile.collectors['axios']` to `profile.collectors['http-client']`.

  Migrate by installing `@eleven-labs/nest-profiler-http` and replacing `AxiosCollectorModule` with `HttpCollectorModule` (same options). Keep `HttpModule` from `@nestjs/axios` in the same module to use the axios adapter.

> Renamed from `@eleven-labs/nest-profiler-axios`. Earlier entries below predate the rename.

## 1.0.0-alpha.3

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.2

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.1

### Patch Changes

- Updated dependencies [e4822c6]
  - @eleven-labs/nest-profiler@1.0.0-alpha.1

## 0.5.1-alpha.0

### Patch Changes

- ff89de2: First public npm (alpha) release. `@eleven-labs/nest-profiler-axios` is the HTTP-client collector for `@eleven-labs/nest-profiler`:
  - Captures outgoing HTTP requests made through the `@nestjs/axios` `HttpService` (method, URL, status code, duration).
  - Displays them in the **HTTP Client** panel with per-request timing bars and a collapsible Request/Response headers + body detail (JSON syntax highlighting).
  - Capture options: `captureRequestHeaders` (default `true`), `captureRequestBody` (default `true` for non-GET/HEAD), `captureResponseHeaders` (default `true`), `captureResponseBody` (default `false`).
  - Automatic masking of sensitive headers (`authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `proxy-authorization`), extendable via `maskHeaders`.
  - Request-count badge with error highlighting (e.g. `3 (1 err)`); idempotent instrumentation (`__profilerPatched`) so requests are never recorded twice.
  - `enabled` option (no-op providers when `false`) and `AxiosCollectorModule.forRoot()`; optional peer dependencies on `@nestjs/axios` and `axios`.

- Updated dependencies [ff89de2]
  - @eleven-labs/nest-profiler@0.5.1-alpha.0
