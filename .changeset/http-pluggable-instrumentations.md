---
'@eleven-labs/nest-profiler-http': major
---

Make the HTTP collector genuinely client-agnostic: pluggable axios/fetch instrumentations with subpath exports and auto-discovery, plus a documented path to bring your own client.

BREAKING: adapters are now selected explicitly by importing their class from a subpath; the `axios` flag and the `axiosRef` option are removed.

- Ship two opt-in, subpath-isolated instrumentations, each selected via `instrumentations: [...]`: `AxiosInstrumentation` (`/axios`) and `FetchInstrumentation` (`/fetch`). Both capture request and response bodies safely. Nothing is instrumented unless listed; the root barrel exports only the client-agnostic API and never loads a client library.
- `AxiosInstrumentation` now **auto-discovers** every axios instance in the DI container via `DiscoveryService` — every `@nestjs/axios` `HttpService` (including per-feature `HttpModule.register()` instances) and bare axios instances — so multiple clients are captured with no per-instance wiring. It still never imports `@nestjs/axios`.
- `FetchInstrumentation` patches `globalThis.fetch` (Node ≥ 22 built-in, undici-backed) and needs no dependency.
- Any other client (got, undici, superagent, a bespoke NestJS service…) is covered by implementing the `HttpInstrumentation` interface with the client's own hooks, or by recording inline via `HttpProfilerRecorder.capture(...)` — both documented, and both yield full request/response fidelity.
- BREAKING: the `axios` boolean flag is removed — select axios via `instrumentations: [AxiosInstrumentation]`. The `axiosRef` option is removed — the axios adapter auto-discovers instances instead. `AxiosInstrumentation` moves from the root barrel to the `@eleven-labs/nest-profiler-http/axios` subpath.

Migrate by dropping the `forRootAsync({ axiosRef })` wiring and selecting adapters instead: `HttpCollectorModule.forRoot({ instrumentations: [AxiosInstrumentation] })`, importing `AxiosInstrumentation` from `@eleven-labs/nest-profiler-http/axios`.
