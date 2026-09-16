import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createMCPClient } from '@ai-sdk/mcp';
import type { ToolSet } from 'ai';
import { markMcpTools } from '@eleven-labs/nest-profiler-ai';

type McpClient = Awaited<ReturnType<typeof createMCPClient>>;

/**
 * Tools borrowed from a Model Context Protocol server, merged into the assistant's own.
 *
 * Off unless `AI_MCP_URL` points at one. The profiler needs nothing special for them: an MCP tool
 * is an AI SDK tool, so it is declared, called and executed through the same events as a local one
 * — and, being discovered at runtime, it is reported as `dynamic` in the AI panel.
 */
@Injectable()
export class McpToolsProvider implements OnApplicationShutdown {
  private readonly logger = new Logger(McpToolsProvider.name);
  private client: McpClient | undefined;
  private tools: ToolSet = {};

  constructor(private readonly config: ConfigService) {}

  /** Connects on first use and caches the tool set; a server that is down degrades to no tools. */
  async load(): Promise<ToolSet> {
    const url = this.config.get<string>('ai.mcpUrl') ?? '';
    if (url === '' || this.client) return this.tools;

    try {
      this.client = await createMCPClient({ transport: { type: 'http', url } });
      this.tools = await this.client.tools();
      markMcpTools(Object.keys(this.tools));
      this.logger.log(`MCP server ${url} offered ${Object.keys(this.tools).length} tool(s)`);
    } catch (error) {
      this.logger.warn(`MCP server ${url} unreachable: ${String(error)}`);
      this.client = undefined;
    }
    return this.tools;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client?.close();
  }
}
