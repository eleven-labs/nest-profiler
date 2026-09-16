/**
 * Names of the tools that came from an MCP server.
 *
 * The AI SDK's telemetry sees a tool by name only; whether it was declared in this application's
 * code or discovered on an MCP server is something only the application knows. `McpToolsProvider`
 * records what it loaded here, and the collector reads it back to label each tool's origin.
 */
const mcpToolNames = new Set<string>();

export function markMcpTools(names: readonly string[]): void {
  for (const name of names) mcpToolNames.add(name);
}

export function isMcpTool(name: string): boolean {
  return mcpToolNames.has(name);
}
