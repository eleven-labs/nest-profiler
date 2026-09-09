# @eleven-labs/nest-profiler-http

## 1.0.0

### Major Changes

- 3a507ec: First stable release. `@eleven-labs/nest-profiler-http` captures outgoing HTTP requests and shows them in an **HTTP Client** panel.

  - **Client-agnostic by construction.** The package owns the `HttpRequestEntry` contract, the collector, the `HttpProfilerRecorder` and the `HttpInstrumentation` interface, and never depends on an HTTP-client library. Nothing is patched unless you opt into it.
  - **Two subpath-isolated adapters** — `@eleven-labs/nest-profiler-http/axios` and `/fetch` — that you register explicitly. Any other client is instrumented the same way by implementing `HttpInstrumentation`.
  - **Phase timings** — opt-in providers break each call down into DNS, handshake, time-to-first-byte and download.
  - Request and response bodies are captured within configurable size and depth caps, redacted before storage, with outgoing request URLs masked too. **Copy as cURL** reproduces any call.
  - A configurable `error` definition (default: threw, or answered >= 500) and the shared chatty/slow performance rules on the `http` domain.

  Requires Node >= 22, NestJS 11 and `@eleven-labs/nest-profiler` ^1.0.0. `axios` is an optional peer, needed only for the axios adapter.

  Documentation: https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-http
