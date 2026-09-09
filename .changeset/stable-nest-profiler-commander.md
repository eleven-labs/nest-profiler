---
'@eleven-labs/nest-profiler-commander': major
---

First stable release. `@eleven-labs/nest-profiler-commander` profiles CLI commands built with [nest-commander](https://nest-commander.jaymcdoniel.dev) — the console counterpart to request profiling.

- `CommanderCollectorModule` turns every command run into its own profile, listed in a dedicated **Commands** view with a **Command** detail tab holding the arguments, the parsed options and the outcome. Any HTTP, cache or database activity the command triggered is collected on the same profile.
- A non-zero exit is a failure, with no configuration needed; option-parse failures are profiled too instead of vanishing before the command runs.
- `CommanderDiscoverSource` contributes the **Discover / Commands** view, listing every command with its arguments and options.

Use the file or SQLite storage so command profiles survive the process and show up next to HTTP requests at `/_profiler`.

Requires Node >= 22, NestJS 11 and `@eleven-labs/nest-profiler` ^1.0.0, with `nest-commander` ^3.20 as a required peer.

Documentation: https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-commander
