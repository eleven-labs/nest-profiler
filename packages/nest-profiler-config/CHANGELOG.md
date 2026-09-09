# @eleven-labs/nest-profiler-config

## 1.0.0-alpha.20

No changes in this release.

## 1.0.0-alpha.19

No changes in this release.

## 1.0.0-alpha.18

### Minor Changes

- e1ab2bf: Unify redaction configuration, annotate exceptions with source code frames, add custom indexed attributes, and round out the sampling/tracing options with `alwaysProfile`, `debug` and `version`.

  - New `redaction` block on `ProfilerModule.forRoot()` — `{ useDefaults, headers, cookies, queryParams, keys, patterns, replacement }` — replacing the scattered `maskHeaders`/`maskCookies`/`maskQueryParams`/`useDefaultMask*` options with a single, additive configuration surface. The old flat options still work (merged additively with `redaction` when both are set) but are deprecated and will be removed in a future major version.
  - `redact()`/`redactString()` (`@eleven-labs/nest-profiler`) gain `patterns` (extra value regexes) and a configurable `replacement` sentinel, plus a Luhn-validated card-number detector so a 13-19 digit run is only masked when it passes the checksum — an ordinary numeric id of the same length is left alone.
  - New shared `RedactionKeyOptions`/`RedactionHeaderOptions`/`RedactionQueryParamOptions` interfaces exported from the core, adopted by `nest-profiler-config`, `nest-profiler-http` and `nest-profiler-rabbitmq` instead of redeclaring the same fields.
  - Fixed a real drift in `nest-profiler-rabbitmq`: its default masked-header list had only 4 of the core's 6 entries (missing `set-cookie` and `proxy-authorization`). It now reuses the core's list directly.
  - New `sourceContext` option (`boolean | { linesOfContext, maxFrames }`): attaches a source-code excerpt to every captured exception's application stack frames, rendered in the Exceptions tab for the primary exception and each `cause`. Hardened against a forged `Error#stack`: only files under `process.cwd()` with a recognised extension are read, reads are cached (failures too, bounded), and it never throws.
  - New `attributes` option (a plain object, or a per-HTTP-request function) attaching custom indexed facets to a profile, merged into `ProfilerCoreService.getIndexAttributes()` and queryable as `attributes.<key>` the same way the built-in `exception` facet already is.
  - New `version` option stamped on every profile and shown in its header — useful once profiles outlive a deploy (`storageType: 'file'`, SQLite).
  - New `alwaysProfile` option: force-captures a request past the `sampleRate` roll (still subject to `ignoreRequest`/`ignorePaths`, which remain a hard "never profile this").
  - New `debug` option: traces via `Logger.debug` why a request was or wasn't profiled (the profiler's own route, `ignoreRequest`, `ignorePaths`, or the `sampleRate` roll).
  - Fixed: **response headers were never masked**, so a `set-cookie` — a replayable session for as long as the profile lives — was stored and rendered in the clear. Responses now mask on the same list as requests.
  - Fixed: **captured bodies were never redacted**. With `collectBody: true`, a login request body kept its `password` in the clear. Request and response bodies now go through `redact()` with the configured options, applied after the `bodyCaptureLimits` / `maxBodySize` caps.
  - `version` and `sourceContext` now reach every entrypoint, not just HTTP: `version` is stamped on the way to storage, and `@eleven-labs/nest-profiler-commander` annotates a failed command's stack frames on the core's setting.
  - A caller-supplied `redaction.patterns` entry is applied globally even without the `g` flag (it previously masked only the first match), sticky patterns no longer carry `lastIndex` across calls, and a `replacement` containing `$&`/`$1` is written literally instead of being interpolated.

### Patch Changes

- ec8aad8: Consolidate three sets of internals that had been copied across the workspace, and record exception causes.

  **Reading the active profile.** `readProfile`, `readToken`, `readRequest` and `setProfileContext` are the way to reach the profiling context. The CLS store was previously addressed by string literal in 24 places across ten packages, each with its own `try`/`catch` — and `PROFILER_CLS_KEYS`, which existed precisely to prevent that, was used almost nowhere. A mistyped key reads as `undefined` rather than failing, silently turning a collector into a no-op; the accessors remove the opportunity. `PROFILER_CLS_KEYS` also gains the `token` key it was missing while three packages wrote the literal.

  **Exception causes and codes.** `toExceptionEntry` replaces the four hand-rolled constructions of an `ExceptionEntry` (the interceptor's HTTP and non-HTTP paths, the catch-all exception filter, the command profiler), which had all drifted into recording only `name`, `message` and `stack`. Two things are now captured:

  - **`ExceptionEntry.cause`** — the `cause` chain of a wrapped error, recorded recursively to a bounded depth and cycle-safe. An `InternalServerErrorException` says nothing; the `QueryFailedError` underneath says everything. The Exceptions tab renders the chain as one `Caused by` block per level.
  - **`ExceptionEntry.code`** — a machine-readable code carried by the error (`ENOENT`, `ECONNREFUSED`, a driver's own), which the `exception` list filter groups by in preference to the class name.

  Coercion of a non-`Error` throw is deliberately unchanged, so existing profiles keep grouping under `Error`.

  **Shared collector options.** `CollectorModuleOptions` (the `enabled` flag, previously redeclared in twelve interfaces) and `TagSeverityOptions` (the tag severities, redeclared in five) are declared once in the core and extended by each collector's options interface. Only options whose meaning _and_ default are identical everywhere moved: the numeric thresholds stay per package, because a slow SQL query is 100 ms, a slow outgoing HTTP call 300 ms and a slow publish 50 ms — that default is the useful half of the documentation.

  No behaviour change and no configuration change: every option keeps its name, type and default, and the accessors return exactly what the code they replace returned.

- 429397b: Consolidate the HTTP capture plumbing: one response finalizer, one finish hook, one header normaliser, one optional-peer loader.

  packages:

  - The core registers a single `finish` listener (the middleware's). The interceptor registered a second one that duplicated the first's safety net and could only ever guard itself against it with `if (profile.response) return`.
  - `profile.response` is built in one place, `finalizeHttpProfile()`, instead of three. The error paths now hand it the status derived from the exception rather than building a response with the transport's stale `200` and patching it afterwards.
  - Body bounds and masking are resolved once into a shared `HttpCaptureConfig`, so the request (middleware) and response (interceptor) capture cannot bound or mask differently.
  - Every header bag — incoming request, outgoing response, HTTP instrumentations — now goes through `extractHeaders()`, which gained an optional third argument: `replacement` for a custom sentinel and `multiValue` to keep a repeated header as an array. Response headers therefore gain the fuller value handling (`Headers`, `Map`, `toJSON()`, `Date`, `bigint`) the instrumentations already had.
  - The per-request transport state (`deferCollection`, the transport response-body getter) moved from `Symbol` properties on the `Profile` to a private `WeakMap`, removing the `as unknown as Record<symbol, unknown>` casts and keeping request plumbing off the profile document.
  - New public helpers `loadOptionalPeer()` / `resolveOptionalPeer()` tell **absent** (not installed, silent) from **broken** (installed but failed to load, warned) when loading an optional peer, and recover a subpath a package's `exports` map refuses — `@nestjs/core/package.json`, which Nest 12 no longer exports. `@eleven-labs/nest-profiler-config` (NestJS version) and `@eleven-labs/nest-profiler-routes` (`class-validator` metadata) now load their peers through it instead of a `try`/`catch` that swallowed everything.

## 1.0.0-alpha.17

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.16

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.15

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.14

### Patch Changes

- 4895cbb: Fix the collector options that an import cycle was silently dropping.

  `MongooseConnectionPatch`, `ConfigCollector` and `AuthCollector` imported their options token from their own module file, which imports them back: the token was still `undefined` when the class decorators ran, so `@Inject(undefined)` left no token in the injection metadata and the `@Optional()` parameter default took over — the class always received `{}`. `maskKeys` (config), `badge` / `badgeValue` / `maskUserFields` (auth) and `connectionName` (the Mongoose connection patch) were therefore inert, so a key you asked to mask was rendered in clear in the Config panel. Each token now lives next to its `ConfigurableModuleBuilder` in a cycle-free `*-collector.interface.ts` — the layout `nest-profiler-mongoose` already used for `MongooseCollector` — and a regression test asserts the resolved token is present in each class's injection metadata. The module files keep re-exporting the token, so the public API is unchanged.

## 1.0.0-alpha.13

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.12

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.11

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.10

### Patch Changes

- 1735b38: Document the `@alpha` install tag in every package README.

  - Install commands now pin `@eleven-labs/nest-profiler*` packages to the `@alpha` dist-tag, since there is no stable release yet (`@latest` resolves to nothing).
  - Added a short note next to each install snippet explaining the requirement.

## 1.0.0-alpha.9

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.8

### Minor Changes

- 882e5ac: Add `forRootAsync` to every collector whose options are resolved at runtime, so masking, thresholds and capture flags can be driven from `ConfigService` (or any provider) instead of static literals.

  - New `forRootAsync({ imports?, inject?, useFactory })` on `TypeOrmCollectorModule`, `MongooseCollectorModule`, `MikroOrmCollectorModule`, `ConfigCollectorModule`, `AuthCollectorModule`, `RabbitMqCollectorModule` and `ValidatorCollectorModule`, mirroring the existing `HttpCollectorModule.forRootAsync`. Each package also exports a matching `*CollectorModuleAsyncOptions` type.
  - Collectors now share a `ConfigurableModuleBuilder`-based options token and a single `buildCollectorModule` helper (exported from `@eleven-labs/nest-profiler`) that centralizes the synchronous `enabled: false` short-circuit — so disabling behaves consistently across every collector.
  - `enabled` stays a synchronous build-time flag (it decides which providers are registered, which an async factory cannot); per-environment gating remains the host's job via `ConditionalModule.registerWhen(...)`. `HttpCollectorModule` is refactored onto the shared builder with no change to its public API (`HTTP_COLLECTOR_OPTIONS`, `HTTP_INSTRUMENTATIONS`, `axios`/`instrumentations` and the `axiosRef` contract are preserved).
  - `cache`, `commander` and `graphql` are intentionally left `forRoot`-only: their sole option is `enabled`, which has nothing to resolve asynchronously.

- 9b1d8a1: Harden data capture and access control.

  - **Secret redaction everywhere.** A shared redaction utility (`redact`, exported from the core) now masks sensitive object keys (`password`, `token`, `apiKey`, DSN…) and credentials embedded in string values (URL userinfo `user:pass@`, JWTs, `sk-`/`pk-` keys, PEM blocks). It is applied to request headers (`maskHeaders`, default sensitive list — including the raw `cookie` header), config values (DSNs whose key is not itself sensitive, e.g. `DATABASE_URL`), the `@nestjs/config` `_PROCESS_ENV_VALIDATED` firehose is now dropped, SQL parameters (TypeORM/MikroORM), Mongo filters/pipelines, validator rejected values, RabbitMQ payloads, CLI arguments/options, session data, JWT claims and the auth user (now redacted recursively). The redaction sentinel is unified to `[REDACTED]`.
  - **`captureRequestBody` now defaults to `false`** (symmetry with `captureResponseBody`); captured bodies are redacted.
  - **No path traversal / token collisions.** The storage token is always an internal UUID; the client `x-request-id` header is kept only as a display-only `requestId` attribute. The file storage adapter additionally rejects any non-`[A-Za-z0-9_-]` token.
  - **Browser-usable access control.** `ProfilerGuard` now accepts the token via a `?token=` query parameter (not only `Authorization: Bearer`), exempts static assets under `__assets/*`, and compares tokens in constant time. Configuring a token no longer breaks the UI or the injected toolbar.
  - **Security headers** (`Cache-Control: no-store`, strict CSP, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`) on the HTML pages and the JSON export; the `X-Debug-Token` headers can be disabled with `emitDebugHeaders: false`.

### Patch Changes

- 9b1d8a1: Public API and packaging cleanup before the stable release (breaking).

  - **GraphQL module renamed** for ecosystem consistency: `ProfilerGraphQLModule` → `GraphQLCollectorModule` and `ProfilerGraphQLModuleOptions` → `GraphQLCollectorModuleOptions` (all 11 other collectors already use `XxxCollectorModule`). No alias — update imports.
  - **`PROFILER_CONTEXT_ADAPTERS` removed** from the public API. It was never consumed by the core; the single supported way to register a context adapter is `ProfilerCoreService.registerContextAdapter(adapter)` from your module's `onModuleInit` (resolve the core with `moduleRef.get(ProfilerCoreService, { strict: false })`). The dead multi-token providers in the GraphQL and RabbitMQ modules are gone.
  - **Named ORM connections supported.** `TypeOrm`/`Mongoose`/`MikroOrm` collector options gain a `connectionName?: string`; the (optionally named) connection is injected by its resolved token, optionally, so a named-only setup no longer crashes at bootstrap and a missing connection warns instead. A `getRequest()` on context adapters lets the interceptor repose the transport request in CLS (fixes GraphQL requests showing as anonymous in the Security panel).
  - **Peer dependencies tightened.** The core peer on every collector is bounded (`>=1.0.0-alpha.7 <2.0.0`) instead of an unbounded `>=`. Optional peers (`axios`, `@golevelup/nestjs-rabbitmq`, `amqplib`, `@nestjs/graphql`, `class-validator`, `class-transformer`) are now declared in `peerDependencies` with ranges (plus `optional: true` in meta). `nest-profiler-http` no longer peer-depends on `@nestjs/axios` (it never imports it — you provide `axiosRef` via `forRootAsync`); `nest-profiler-commander` now declares `nest-commander` as a **required** peer (imported statically) rather than optional. ORM peer ranges widened to cover the installed base: `typeorm ">=0.3.20 <2.0.0"`, `mongoose "^8 || ^9"`. `nest-profiler-mikro-orm` requires Node `>=22.12.0` (stable `require(esm)`).
  - **Misc.** A throwing custom validator extractor can no longer turn a 400 into a 500; the RabbitMQ adapter's options are `@Optional()`; the dead `COMMANDER_COLLECTOR_OPTIONS` token is removed; the RabbitMQ package builds via the shared `repo-build`. `@golevelup/nestjs-rabbitmq` is now a dev dependency.

- 9b1d8a1: Minor correctness and robustness fixes.

  - **Storage query parity** between the in-memory/file and SQLite backends: `contains` is now case-insensitive on both sides; LIKE wildcards (`%`, `_`) in a filter value are escaped (no false positives); results have a deterministic `token` tie-breaker so pagination is stable across equal timestamps; an empty `typeIn` consistently means "no type constraint".
  - **Memory adapter** no longer evicts the oldest profile when re-saving an existing token (e.g. the GraphQL backfill), which previously shrank the store below its cap.
  - **Storage lifecycle**: adapters may implement `close()`; the profiler calls it on shutdown after a **bounded** drain of pending saves (so a hung custom adapter can't block graceful shutdown), and the SQLite handle is closed/checkpointed.
  - **Route matching** escapes regex metacharacters and supports param constraints (`:id(\\d+)`) without throwing, and compiles each pattern once instead of per request.
  - **Cache collector** records failed cache operations (with an `error`) instead of dropping them, and restores the patched methods on module destroy.
  - **Robustness**: the config panel warns when it reads empty despite a `ConfigService` (canary on the private `internalConfig`); MikroORM re-evaluates the host's query-logging setting per call and surfaces the real error message; the `mongosh` copy command uses safe serialization; the HTTP-request detail template guards missing `query`/`headers`; the client copy button tolerates malformed base64 and escapes group ids with `CSS.escape`; interpolated SQL escapes backslashes.

## 1.0.0-alpha.7

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.6

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.5

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.4

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

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

- ff89de2: First public npm (alpha) release. `@eleven-labs/nest-profiler-config` is the `@nestjs/config` collector for `@eleven-labs/nest-profiler`:
  - Captures a flattened snapshot of the `ConfigService` configuration at application bootstrap.
  - Global collector — appears on the profiles list and on every profile detail view, in the **Config** panel.
  - Secret/sensitive-key masking via `maskKeys` (dot-notation supported, e.g. `database.password`); masked values shown as `***`.
  - `enabled` option — when `false`, registers no-op providers only (the host app owns the dev/prod decision).
  - `ConfigCollectorModule.forRoot()` configuration.

- Updated dependencies [ff89de2]
  - @eleven-labs/nest-profiler@0.5.1-alpha.0
