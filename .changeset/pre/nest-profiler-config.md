---
'@eleven-labs/nest-profiler-config': patch
---

First public npm (alpha) release. `@eleven-labs/nest-profiler-config` is the `@nestjs/config` collector for `@eleven-labs/nest-profiler`:

- Captures a snapshot of the `ConfigService` configuration at application bootstrap, **grouped by namespace**: each `registerAs` namespace (loaded via `ConfigModule.forRoot({ load })` or `forFeature`) is its own collapsible section with keys shown relative to the namespace; top-level scalar values are gathered under a **General** section.
- Global collector — appears on the profiles list and on every profile detail view, in the **Config** panel.
- Secret/sensitive-key masking via `maskKeys` (dot-notation supported, e.g. `database.password`); masked values shown as `***`.
- `enabled` option — when `false`, registers no-op providers only (the host app owns the dev/prod decision).
- `ConfigCollectorModule.forRoot()` configuration.
