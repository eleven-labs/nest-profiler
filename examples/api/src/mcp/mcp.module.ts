import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller.js';
import { McpServerService } from './mcp-server.service.js';

/**
 * Serves this application's own capabilities over the Model Context Protocol.
 *
 * Standalone on purpose: an MCP server is a way to expose an application to *any* agent, not a
 * piece of the assistant. It does mean the demo can point `AI_MCP_URL` at itself, which is the
 * shortest path to seeing an MCP tool run inside a profile — and why it is mounted behind
 * `FEATURE_AI` at the composition root rather than served everywhere.
 */
@Module({
  controllers: [McpController],
  providers: [McpServerService],
})
export class McpModule {}
