---
'@eleven-labs/nest-profiler-ai': minor
---

Record AI SDK agents. A `ToolLoopAgent` run — and everything built on it, including `createAgentUIStream`, `createAgentUIStreamResponse` and `pipeAgentUIStreamToResponse` — is now marked as an agent run in the AI panel, and named after the agent's own `id` setting: the module instruments the agent class once at startup, so no application code imports the profiler to be attributed. Every call, step and tool execution carries its agent, the trace labels its spans with it, and the AI list gains an `Agent` filter. `profileAgent` is exported as an escape hatch for a custom `Agent` implementation or a name that should differ from the id.
