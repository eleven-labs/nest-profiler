# @eleven-labs/nest-profiler-commander

## 0.0.1

### Features

- Initial release: CLI command collector for `@eleven-labs/nest-profiler` via [nest-commander](https://nest-commander.jaymcdoniel.dev/)
- Automatically profiles every nest-commander command — no changes to your command classes
- Each command run produces a profile (shown alongside HTTP profiles in the web profiler at `/_profiler`) with the command name, positional arguments, parsed options, duration, and exit code
- Runs the command body inside the profiler's CLS context so other collectors (HTTP client, cache, database, …) capture the activity a command triggers — just like Symfony's console profiling
- Sets `request.command` so the profiler UI renders commands in a dedicated **Commands** table and a built-in **Command** tab (no request/response tabs) — no extra setup in the HTTP app
- Exceptions thrown by a command are captured and the profile is marked as failed (HTTP-equivalent status `500`)
- `enabled` option — when `false`, registers no providers (the host application owns the dev/prod decision)
- `CommanderCollectorModule.forRoot()` configuration
- Optional peer dependency on `nest-commander` (the collector is a no-op when it is not installed)
