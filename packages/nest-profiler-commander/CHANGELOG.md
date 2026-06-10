# @eleven-labs/nest-profiler-commander

## 1.0.0-alpha.2

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.1

### Patch Changes

- Updated dependencies [e4822c6]
  - @eleven-labs/nest-profiler@1.0.0-alpha.1

## 0.5.1-alpha.0

### Patch Changes

- ff89de2: First public npm (alpha) release. `@eleven-labs/nest-profiler-commander` profiles CLI commands built with [nest-commander](https://nest-commander.jaymcdoniel.dev/) — the console equivalent of Symfony's command profiling:
  - Automatically profiles every nest-commander command, with no changes to your command classes.
  - Each run produces a profile (shown alongside HTTP profiles at `/_profiler`) with the command name, positional arguments, parsed options, duration, and exit code.
  - Runs the command body inside the profiler's CLS context, so other collectors (HTTP client, cache, database, …) capture the activity a command triggers.
  - Sets `request.command` so the UI renders commands in a dedicated **Commands** table and **Command** tab.
  - Exceptions thrown by a command are captured and the profile is marked as failed (HTTP-equivalent status `500`).
  - `enabled` option (no providers when `false`) and `CommanderCollectorModule.forRoot()`; optional peer dependency on `nest-commander` (no-op when absent).

- Updated dependencies [ff89de2]
  - @eleven-labs/nest-profiler@0.5.1-alpha.0
