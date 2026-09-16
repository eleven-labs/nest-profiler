import { Controller, Delete, Get, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { McpServerService } from './mcp-server.service.js';
import { ApiMcpBody } from './mcp-openapi.js';
import type { McpRequest } from './mcp-request.js';
import type { PlatformResponse } from '../shared/platform-response.js';

/**
 * The application's MCP endpoint, at `/mcp`.
 *
 * Kept off the global `api/v1` prefix: MCP is its own protocol over its own conventional path. The
 * three verbs are the Streamable HTTP transport's, and they are declared separately rather than
 * with one `@All()` so Swagger can document each of them.
 *
 * The body is deliberately **not** bound with `@Body()`: the app's global validation pipe strips
 * unknown properties, which would quietly mangle a JSON-RPC envelope. It is documented through
 * `@ApiBody` instead, and read from the raw request.
 */
@ApiTags('mcp')
@Controller('mcp')
export class McpController {
  constructor(private readonly mcp: McpServerService) {}

  @Post()
  @ApiOperation({
    summary: 'Send a JSON-RPC message to the MCP server',
    description:
      'The Model Context Protocol endpoint this application exposes. Answers over Server-Sent ' +
      'Events, so the profiler files it as a streamed response. Try `tools/list` to see what the ' +
      'server offers, then `tools/call` to run one.',
  })
  @ApiMcpBody()
  @ApiResponse({
    status: 200,
    description: 'A JSON-RPC response, streamed as `text/event-stream`',
  })
  send(@Req() request: McpRequest, @Res() response: PlatformResponse): Promise<void> {
    return this.mcp.handle(request, response);
  }

  @Get()
  @ApiOperation({
    summary: 'Open the server-to-client event stream',
    description: 'The half of the transport the server pushes notifications down.',
  })
  @ApiResponse({ status: 200, description: 'An open `text/event-stream`' })
  stream(@Req() request: McpRequest, @Res() response: PlatformResponse): Promise<void> {
    return this.mcp.handle(request, response);
  }

  @Delete()
  @ApiOperation({ summary: 'End the session, for a client that opened one' })
  @ApiResponse({ status: 200, description: 'The session is closed' })
  end(@Req() request: McpRequest, @Res() response: PlatformResponse): Promise<void> {
    return this.mcp.handle(request, response);
  }
}
