# @eleven-labs/nest-profiler-axios

## 0.5.0

### Minor Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 0.4.0

### Patch Changes

- 88a9794: Make host-library instrumentation idempotent with a `__profilerPatched` guard, matching the Mongoose collector. Re-initialization (tests, multiple data sources/ORMs) no longer double-wraps queries, HTTP requests or cache operations, which previously caused entries to be recorded twice.

## 0.3.0

### Minor Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 0.2.0

### Minor Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 0.1.0

### Minor Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 0.0.1

### Features

- Initial release: Axios/HTTP client collector for `@eleven-labs/nest-profiler`
- Captures outgoing HTTP requests made via `@nestjs/axios` `HttpService`
- Records method, URL, status code, and duration for each request
- Displays requests in the **HTTP Client** panel with per-request timing bars
- Collapsible detail section per row: Request and Response headers + body with JSON syntax highlighting
- Options:
  - `captureRequestHeaders` — default: `true`; sensitive headers masked automatically
  - `captureRequestBody` — default: `true` for non-GET/HEAD methods
  - `captureResponseHeaders` — default: `true`; sensitive headers masked automatically
  - `captureResponseBody` — default: `false` (opt-in — response bodies can be large)
  - `maskHeaders` — header names (lowercase) to redact, merged with the built-in list
- Default masked headers: `authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `proxy-authorization`
- Badge shows request count; errors highlighted (e.g. `3 (1 err)`)
- `enabled` option — when `false`, registers no-op providers only (the host application owns the dev/prod decision)
- `AxiosCollectorModule.forRoot()` configuration
- Optional peer dependencies on `@nestjs/axios` and `axios`
