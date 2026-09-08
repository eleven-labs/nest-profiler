---
'@eleven-labs/nest-profiler-commander': major
---

Stop collecting a command's exit code.

**BREAKING:** `CommandInfo.exitCode` is removed, and the **Command** tab no longer shows an _Exit Code_ card. The field was never observed — the collector wraps `run()` from inside the process, so it cannot know the code the CLI eventually exits with; it was derived as `error ? 1 : 0`, saying exactly what `success` already said. Read `entrypoint.data.success`, or the profile's `response.statusCode` (`200` / `500`), instead.
