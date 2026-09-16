import { ApiBody } from '@nestjs/swagger';

export const ApiMcpBody = (): MethodDecorator =>
  ApiBody({
    schema: {
      type: 'object',
      required: ['jsonrpc', 'method'],
      properties: {
        jsonrpc: { type: 'string', enum: ['2.0'] },
        id: {
          oneOf: [{ type: 'number' }, { type: 'string' }],
          description: 'Omit for a notification',
        },
        method: { type: 'string', example: 'tools/list' },
        params: { type: 'object', additionalProperties: true },
      },
    },
    examples: {
      initialize: {
        summary: 'Handshake — start here',
        value: {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'swagger-ui', version: '1.0.0' },
          },
        },
      },
      listTools: {
        summary: 'List the tools this server offers',
        value: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      },
      callShout: {
        summary: 'Call the `shout` tool',
        value: {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'shout', arguments: { text: 'profiler' } },
        },
      },
      callAppInfo: {
        summary: 'Call the `appInfo` tool',
        value: {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: 'appInfo', arguments: {} },
        },
      },
    },
  });
