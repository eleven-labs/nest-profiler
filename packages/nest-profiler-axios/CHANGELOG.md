# @eleven-labs/nest-profiler-axios

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
