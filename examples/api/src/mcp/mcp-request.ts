import type { IncomingMessage } from 'node:http';

/** The Node request an MCP call arrives on, with the body Nest's parser already read. */
export type McpRequest = IncomingMessage & { body?: unknown };
