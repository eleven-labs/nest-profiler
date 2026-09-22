---
'@eleven-labs/nest-profiler-ai': minor
---

Label MCP tools without the application declaring them. The collector now recognises the tools `@ai-sdk/mcp`'s client builds from the tool set the AI SDK hands over when an operation starts, so calling `markMcpTools` is no longer needed — which keeps the import out of application code, and out of the way of a `devDependencies`-only install. Detection is scoped to the operation, so a local tool sharing a name with a remote one is no longer mislabelled. `markMcpTools` stays for integrations that build their MCP tools themselves.
