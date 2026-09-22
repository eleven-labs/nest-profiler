/**
 * Which tools came from an MCP server, so the panel can label their origin.
 *
 * The provider only ever sees a tool's name and schema, so by the time the AI SDK reports a call
 * there is nothing left to tell a tool declared in this application's code from one discovered on
 * a server at runtime. The tool *object* still says so, though, and the SDK hands it over on an
 * operation's start event — which is why {@link mcpToolNamesOf} reads it there rather than asking
 * the application to declare anything.
 */

/**
 * `@ai-sdk/mcp` builds every tool it discovers with `dynamicTool(…)` and then attaches the MCP
 * protocol's `_meta` to it, present as an own property even when the server sent none. A local
 * `tool()` has neither mark and a local `dynamicTool()` has only the first, so the pair identifies
 * an MCP tool without the application saying a word.
 */
function isMcpToolDefinition(tool: unknown): boolean {
  if (typeof tool !== 'object' || tool === null) return false;
  return (tool as { type?: unknown }).type === 'dynamic' && '_meta' in tool;
}

/** The names of the MCP tools in a tool set, as the AI SDK reports it on an operation's start. */
export function mcpToolNamesOf(tools: unknown): Set<string> {
  const names = new Set<string>();
  if (typeof tools !== 'object' || tools === null) return names;
  for (const [name, tool] of Object.entries(tools as Record<string, unknown>)) {
    if (isMcpToolDefinition(tool)) names.add(name);
  }
  return names;
}

/**
 * Names declared by the application rather than detected — the escape hatch for an integration
 * that builds its MCP tools itself instead of through `@ai-sdk/mcp`'s client.
 */
const mcpToolNames = new Set<string>();

export function markMcpTools(names: readonly string[]): void {
  for (const name of names) mcpToolNames.add(name);
}

export function isMcpTool(name: string): boolean {
  return mcpToolNames.has(name);
}
