---
'@eleven-labs/nest-profiler-commander': minor
---

Own the command profile shape and its UI instead of relying on core types.

`CommandProfiler` now builds a `command` entrypoint (`entrypoint.type = 'command'`, the command details on `entrypoint.data`). The package exports its own `CommandInfo` type and `COMMAND_ENTRYPOINT_TYPE`, and `CommanderCollectorModule` registers a `command` entrypoint type with the profiler core — contributing the Commands list table, the **Command** detail tab and a **Status** (success / failed) filter above the Commands list. Import the module in your HTTP app too when you want command profiles produced by the CLI process (shared via file storage) to render in its web profiler.
