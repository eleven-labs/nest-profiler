---
'@eleven-labs/nest-profiler-commander': minor
---

Add `@eleven-labs/nest-profiler-commander` — profile CLI commands built with `nest-commander`, the console equivalent of Symfony's command profiling. Every command run is wrapped automatically (no code change) and produces a profile, shown alongside HTTP profiles at `/_profiler`, with a **Command** panel plus any HTTP, cache, or database activity the command triggered. Failed commands are captured with their exception.
