---
'@eleven-labs/nest-profiler': patch
'@eleven-labs/nest-profiler-config': patch
'@eleven-labs/nest-profiler-routes': patch
---

Consolidate the HTTP capture plumbing: one response finalizer, one finish hook, one header normaliser, one optional-peer loader.

packages:

- The core registers a single `finish` listener (the middleware's). The interceptor registered a second one that duplicated the first's safety net and could only ever guard itself against it with `if (profile.response) return`.
- `profile.response` is built in one place, `finalizeHttpProfile()`, instead of three. The error paths now hand it the status derived from the exception rather than building a response with the transport's stale `200` and patching it afterwards.
- Body bounds and masking are resolved once into a shared `HttpCaptureConfig`, so the request (middleware) and response (interceptor) capture cannot bound or mask differently.
- Every header bag — incoming request, outgoing response, HTTP instrumentations — now goes through `extractHeaders()`, which gained an optional third argument: `replacement` for a custom sentinel and `multiValue` to keep a repeated header as an array. Response headers therefore gain the fuller value handling (`Headers`, `Map`, `toJSON()`, `Date`, `bigint`) the instrumentations already had.
- The per-request transport state (`deferCollection`, the transport response-body getter) moved from `Symbol` properties on the `Profile` to a private `WeakMap`, removing the `as unknown as Record<symbol, unknown>` casts and keeping request plumbing off the profile document.
- New public helpers `loadOptionalPeer()` / `resolveOptionalPeer()` tell **absent** (not installed, silent) from **broken** (installed but failed to load, warned) when loading an optional peer, and recover a subpath a package's `exports` map refuses — `@nestjs/core/package.json`, which Nest 12 no longer exports. `@eleven-labs/nest-profiler-config` (NestJS version) and `@eleven-labs/nest-profiler-routes` (`class-validator` metadata) now load their peers through it instead of a `try`/`catch` that swallowed everything.
