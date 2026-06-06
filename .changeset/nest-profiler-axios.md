---
'@eleven-labs/nest-profiler-axios': patch
---

First public npm (alpha) release. `@eleven-labs/nest-profiler-axios` is the HTTP-client collector for `@eleven-labs/nest-profiler`:

- Captures outgoing HTTP requests made through the `@nestjs/axios` `HttpService` (method, URL, status code, duration).
- Displays them in the **HTTP Client** panel with per-request timing bars and a collapsible Request/Response headers + body detail (JSON syntax highlighting).
- Capture options: `captureRequestHeaders` (default `true`), `captureRequestBody` (default `true` for non-GET/HEAD), `captureResponseHeaders` (default `true`), `captureResponseBody` (default `false`).
- Automatic masking of sensitive headers (`authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `proxy-authorization`), extendable via `maskHeaders`.
- Request-count badge with error highlighting (e.g. `3 (1 err)`); idempotent instrumentation (`__profilerPatched`) so requests are never recorded twice.
- `enabled` option (no-op providers when `false`) and `AxiosCollectorModule.forRoot()`; optional peer dependencies on `@nestjs/axios` and `axios`.
