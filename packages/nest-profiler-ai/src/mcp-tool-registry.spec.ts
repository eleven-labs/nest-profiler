import { isMcpTool, markMcpTools, mcpToolNamesOf } from './mcp-tool-registry';

/** How `@ai-sdk/mcp` builds a tool it discovered: `dynamicTool(…)`, then the protocol's `_meta`. */
const mcpTool = (meta?: unknown): Record<string, unknown> => ({
  description: 'Uppercase the given text. Served over MCP.',
  inputSchema: { type: 'object' },
  execute: () => undefined,
  type: 'dynamic',
  _meta: meta,
});

/** How an application declares its own: `tool(…)`, and `dynamicTool(…)` for a runtime schema. */
const localTool = (): Record<string, unknown> => ({
  description: 'Read the feature flags.',
  inputSchema: { type: 'object' },
  execute: () => undefined,
});
const localDynamicTool = (): Record<string, unknown> => ({ ...localTool(), type: 'dynamic' });

describe('mcpToolNamesOf', () => {
  it('finds the tools an MCP client built, and only those', () => {
    const tools = {
      shout: mcpTool(),
      appFeatures: localTool(),
      lateBound: localDynamicTool(),
      remoteSearch: mcpTool({ 'io.modelcontextprotocol/title': 'Search' }),
    };

    expect([...mcpToolNamesOf(tools)]).toEqual(['shout', 'remoteSearch']);
  });

  it('counts a tool whose server sent no metadata: `_meta` is there either way', () => {
    // The distinguishing mark is the property, not its value — `{ ...tool, _meta }` always sets it.
    expect(mcpToolNamesOf({ shout: mcpTool(undefined) }).has('shout')).toBe(true);
  });

  it.each([
    ['no tools at all', undefined],
    ['an empty tool set', {}],
    ['something that is not a tool set', 'tools'],
    ['a tool set with a null entry', { broken: null }],
    ['a `_meta` on a tool that is not dynamic', { odd: { ...localTool(), _meta: {} } }],
  ])('finds nothing in %s', (_case, tools) => {
    expect(mcpToolNamesOf(tools).size).toBe(0);
  });
});

describe('markMcpTools', () => {
  it('still labels names an integration declares itself', () => {
    expect(isMcpTool('handRolled')).toBe(false);

    markMcpTools(['handRolled']);

    expect(isMcpTool('handRolled')).toBe(true);
  });
});
