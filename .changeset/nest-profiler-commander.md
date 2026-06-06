---
'@eleven-labs/nest-profiler-commander': patch
---

First public npm (alpha) release. `@eleven-labs/nest-profiler-commander` profiles CLI commands built with [nest-commander](https://nest-commander.jaymcdoniel.dev/) — the console equivalent of Symfony's command profiling:

- Automatically profiles every nest-commander command, with no changes to your command classes.
- Each run produces a profile (shown alongside HTTP profiles at `/_profiler`) with the command name, positional arguments, parsed options, duration, and exit code.
- Runs the command body inside the profiler's CLS context, so other collectors (HTTP client, cache, database, …) capture the activity a command triggers.
- Sets `request.command` so the UI renders commands in a dedicated **Commands** table and **Command** tab.
- Exceptions thrown by a command are captured and the profile is marked as failed (HTTP-equivalent status `500`).
- `enabled` option (no providers when `false`) and `CommanderCollectorModule.forRoot()`; optional peer dependency on `nest-commander` (no-op when absent).
