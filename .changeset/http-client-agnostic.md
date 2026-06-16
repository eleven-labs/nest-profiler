---
'@eleven-labs/nest-profiler-http': major
'@eleven-labs/nest-profiler-axios': major
---

Make HTTP-client profiling client-agnostic and rename the axios package.

BREAKING: `@eleven-labs/nest-profiler-axios` is renamed to `@eleven-labs/nest-profiler-http`, which is now client-agnostic. The old package is kept as a deprecated re-export shim and will be removed in a future release.

- `@eleven-labs/nest-profiler-http` now owns the full HTTP-client contract: the `HttpRequestEntry` type, the `HttpClientCollector` + panel, the injectable `HttpProfilerRecorder`, the low-level `appendHttpRequestEntry(cls, entry)` helper, the redaction helpers (`DEFAULT_MASK_HEADERS` / `extractHeaders` / `formatHeaderValue`), and a pluggable `HttpInstrumentation` interface. The core `@eleven-labs/nest-profiler` is unchanged and stays HTTP-agnostic.
- axios is now one **instrumentation** (`AxiosInstrumentation`) among others, enabled by default and no-op when `@nestjs/axios` is absent. Any client (fetch, undici, got, custom) feeds the same panel by injecting `HttpProfilerRecorder` or by registering a custom `HttpInstrumentation`.
- The module is renamed `AxiosCollectorModule` → `HttpCollectorModule`; `forRoot()` accepts `axios`, `instrumentations` and the shared `HttpCaptureOptions`. `AxiosCollectorModule` remains exported from the deprecated shim as an alias.
- The collector panel id / storage key is now `http-client` (was `axios`): stored data moves from `profile.collectors['axios']` to `profile.collectors['http-client']`.

Migrate by installing `@eleven-labs/nest-profiler-http` and replacing `AxiosCollectorModule` with `HttpCollectorModule` (same options). Keep `HttpModule` from `@nestjs/axios` in the same module to use the axios adapter.
