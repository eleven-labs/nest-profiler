import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { z } from 'zod';

export interface TestMcpServer {
  /** What `AI_MCP_URL` is pointed at. */
  url: string;
  close(): Promise<void>;
}

/**
 * A real MCP server, built with the official v2 SDK and listening on an ephemeral port.
 *
 * It exists so the MCP path is exercised rather than assumed: the assistant discovers this tool at
 * runtime, calls it, and the profiler must show it like any other — flagged `mcp` because it was
 * never declared in the application's code. Stateless, which is what the 2026-07-28 protocol is:
 * a stateless transport answers a single request, so each one gets its own server and transport.
 */
export async function startTestMcpServer(): Promise<TestMcpServer> {
  const http: Server = createServer((req, res) => {
    void handle(req, res);
  });
  await new Promise<void>((resolve) => {
    http.listen(0, '127.0.0.1', resolve);
  });

  const { port } = http.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () => new Promise<void>((resolve) => http.close(() => resolve())),
  };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const mcp = new McpServer({ name: 'profiler-demo-mcp', version: '1.0.0' });
  mcp.registerTool(
    'shout',
    {
      description: 'Uppercase the given text. Served over MCP.',
      inputSchema: z.object({ text: z.string().describe('Text to uppercase') }),
    },
    ({ text }) => ({ content: [{ type: 'text' as const, text: text.toUpperCase() }] }),
  );

  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void mcp.close();
  });
  await mcp.connect(transport);
  await transport.handleRequest(req, res);
}
