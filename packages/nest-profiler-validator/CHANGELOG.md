# @eleven-labs/nest-profiler-validator

## 0.0.1

### Features

- Initial release: Validation pipe collector for `@eleven-labs/nest-profiler`
- Captures DTO validation results from `class-validator` via `ProfilerValidationPipe`
- Records validated DTO class name, validation status (valid / invalid), and all property violations with constraint names
- Badge shows total DTO count validated during the request (details in the panel)
- Badge reads from final collected storage (always visible even after `collect()` clears the private key)
- `enabled` option — when `false`, registers no-op providers only (the host application owns the dev/prod decision)
- `ValidatorCollectorModule.forRoot()` configuration with `whitelist`, `transform`, and other standard `ValidationPipeOptions`
