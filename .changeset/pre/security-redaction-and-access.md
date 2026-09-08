---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-config': minor
'@eleven-labs/nest-profiler-auth': minor
'@eleven-labs/nest-profiler-http': minor
'@eleven-labs/nest-profiler-typeorm': minor
'@eleven-labs/nest-profiler-mikro-orm': minor
'@eleven-labs/nest-profiler-mongoose': minor
'@eleven-labs/nest-profiler-rabbitmq': minor
'@eleven-labs/nest-profiler-commander': minor
'@eleven-labs/nest-profiler-validator': minor
---

Harden data capture and access control.

- **Secret redaction everywhere.** A shared redaction utility (`redact`, exported from the core) now masks sensitive object keys (`password`, `token`, `apiKey`, DSN…) and credentials embedded in string values (URL userinfo `user:pass@`, JWTs, `sk-`/`pk-` keys, PEM blocks). It is applied to request headers (`maskHeaders`, default sensitive list — including the raw `cookie` header), config values (DSNs whose key is not itself sensitive, e.g. `DATABASE_URL`), the `@nestjs/config` `_PROCESS_ENV_VALIDATED` firehose is now dropped, SQL parameters (TypeORM/MikroORM), Mongo filters/pipelines, validator rejected values, RabbitMQ payloads, CLI arguments/options, session data, JWT claims and the auth user (now redacted recursively). The redaction sentinel is unified to `[REDACTED]`.
- **`captureRequestBody` now defaults to `false`** (symmetry with `captureResponseBody`); captured bodies are redacted.
- **No path traversal / token collisions.** The storage token is always an internal UUID; the client `x-request-id` header is kept only as a display-only `requestId` attribute. The file storage adapter additionally rejects any non-`[A-Za-z0-9_-]` token.
- **Browser-usable access control.** `ProfilerGuard` now accepts the token via a `?token=` query parameter (not only `Authorization: Bearer`), exempts static assets under `__assets/*`, and compares tokens in constant time. Configuring a token no longer breaks the UI or the injected toolbar.
- **Security headers** (`Cache-Control: no-store`, strict CSP, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`) on the HTML pages and the JSON export; the `X-Debug-Token` headers can be disabled with `emitDebugHeaders: false`.
