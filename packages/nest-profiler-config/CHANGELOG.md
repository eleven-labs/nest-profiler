# @eleven-labs/nest-profiler-config

## 0.0.1

### Features

- Initial release: `@nestjs/config` collector for `@eleven-labs/nest-profiler`
- Captures a flattened snapshot of `ConfigService` configuration at application bootstrap
- Secret/sensitive key masking via `maskKeys` option (supports dot-notation, e.g. `database.password`)
- Global collector — appears on the profiles list and every profile detail view
- Displays configuration in the **Config** panel with masked values shown as `***`
- `enabled` option — when `false`, registers no-op providers only (the host application owns the dev/prod decision)
- `ConfigCollectorModule.forRoot()` configuration
