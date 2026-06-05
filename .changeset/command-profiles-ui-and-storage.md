---
'@eleven-labs/nest-profiler': minor
---

Support CLI command profiles in the web UI and make file storage reflect other processes:

- New `request.command` field (`CommandInfo`) so a profile can describe a CLI command instead of an HTTP request. The list page shows a dedicated **Commands** table, and the detail page renders a built-in **Command** tab (no request/response tabs) for these profiles.
- `FileStorageAdapter` now reconciles its in-memory index with the directory on every read, so profiles written by another process (e.g. a CLI command run while the web server is up) appear without restarting — and files removed externally drop out.
- Added an optional `crossProcess` capability to `IProfilerStorageAdapter` (`MemoryStorageAdapter` → `false`, `FileStorageAdapter` → `true`) so tooling can detect process-local stores.
