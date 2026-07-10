---
'@eleven-labs/nest-profiler': minor
---

Add a pluggable `security` option to protect the profiler UI/API, so consumers can enforce **any** authentication (or none — the profiler is **open by default**).

- `security.authorize` — a `(ctx) => boolean | Promise<boolean>` predicate over the platform-agnostic `request`/`response` (set a `WWW-Authenticate` header for a Basic challenge). Covers token, Basic, cookie/session, custom header, external calls…
- `security.guards` — one or more NestJS `CanActivate` guards (a class resolved through DI, or a ready instance) to reuse an existing app guard.
- `security.linkQuery` — threads a query-param credential (`?token=`) across the UI links so query-param schemes survive browser navigation (cookies/sessions/Basic auth propagate natively).

Providing several strategies requires **all** to pass; providing none keeps the profiler open. Static assets stay exempt. The JSON export link and UI navigation carry the visitor's credential. New exports: `ProfilerSecurityOptions`, `ProfilerAuthorize`, `ProfilerAuthContext`, `ProfilerGuard`, `PlatformRequest`, `PlatformResponse`.
