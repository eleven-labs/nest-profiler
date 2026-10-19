import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { z } from 'zod';
import type { PlatformResponse } from '../shared/platform-response.js';
import type { McpRequest } from './mcp-request.js';

const REQUIRED_ACCEPT = ['application/json', 'text/event-stream'] as const;

/**
 * Lets a client that only asked for JSON through.
 *
 * The transport answers over Server-Sent Events and rejects a request whose `Accept` does not
 * name both types. Every MCP client sends both; the Swagger UI on `/api` sends only
 * `application/json` and cannot be told otherwise — OpenAPI forbids `Accept` as a parameter — so
 * its `Try it out` would always 406. Widening the header here keeps the documented endpoint
 * usable from the page that documents it, and changes nothing for a real client.
 */
function acceptEventStream(request: McpRequest): void {
  const accept = request.headers.accept ?? '';
  const missing = REQUIRED_ACCEPT.filter((type) => !accept.includes(type));
  if (missing.length === 0) return;

  // A wildcard already means "anything", but the transport matches the two types literally.
  const widened =
    accept === '' || accept.trim() === '*/*'
      ? REQUIRED_ACCEPT.join(', ')
      : [accept, ...missing].join(', ');

  request.headers.accept = widened;
  // The Node-to-web-standard adapter under the transport reads `rawHeaders`, not `headers`.
  const raw = request.rawHeaders;
  const index = raw.findIndex((name, i) => i % 2 === 0 && name.toLowerCase() === 'accept');
  if (index === -1) raw.push('accept', widened);
  else raw[index + 1] = widened;
}

/**
 * The MCP server this application exposes, over one Streamable HTTP endpoint.
 *
 * Stateless, which is what the 2026-07-28 protocol is: every request stands on its own, so nothing
 * has to be kept between them and any instance can answer. A stateless transport answers a single
 * request, so each one gets its own server and transport, closed with the response.
 */
@Injectable()
export class McpServerService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Answers one MCP request. The body is already parsed by Nest's body parser, so it is handed over
   * rather than read again from a stream that has been consumed.
   */
  async handle(request: McpRequest, response: PlatformResponse): Promise<void> {
    acceptEventStream(request);
    const mcp = new McpServer({ name: 'nest-profiler-example', version: '1.0.0' });
    this.registerTools(mcp);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on('close', () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(request, response, request.body);
  }

  private registerTools(mcp: McpServer): void {
    mcp.registerTool(
      'shout',
      {
        description: 'Uppercase the given text.',
        inputSchema: z.object({ text: z.string().describe('Text to uppercase') }),
      },
      ({ text }) => ({ content: [{ type: 'text' as const, text: text.toUpperCase() }] }),
    );

    mcp.registerTool(
      'appInfo',
      {
        description: "This demo application's name, environment and enabled features.",
        inputSchema: z.object({}),
      },
      () => {
        const info = {
          name: 'nest-profiler example API',
          environment: this.config.getOrThrow<string>('app.env'),
          features: this.config.getOrThrow<Record<string, unknown>>('features'),
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(info) }] };
      },
    );
  }
}
