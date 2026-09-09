---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-config': minor
'@eleven-labs/nest-profiler-http': minor
'@eleven-labs/nest-profiler-rabbitmq': minor
'@eleven-labs/nest-profiler-commander': patch
---

Unify redaction configuration, annotate exceptions with source code frames, add custom indexed attributes, and round out the sampling/tracing options with `alwaysProfile`, `debug` and `version`.

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
