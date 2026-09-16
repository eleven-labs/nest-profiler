import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jsonSchema, tool } from 'ai';
import type { ToolSet } from 'ai';
import { McpToolsProvider } from '../infrastructure/mcp/mcp-tools.provider.js';

const ARTICLE_API = 'https://jsonplaceholder.typicode.com/posts';

interface ExternalPost {
  id: number;
  title: string;
  body: string;
}

/**
 * The tools the assistant may call. One answers from the app's own configuration and returns in
 * microseconds; the other goes out over the network — so the profiler's AI panel and trace show
 * both a tool that costs nothing and a tool that costs a round-trip.
 */
@Injectable()
export class AssistantTools {
  constructor(
    private readonly config: ConfigService,
    private readonly mcp: McpToolsProvider,
  ) {}

  /** The tool the approval demo guards: destructive enough that a person should say yes first. */
  static readonly SENSITIVE_TOOL = 'deleteArticle';

  /** The local tools plus whatever an MCP server offers, when one is configured. */
  async buildAll(): Promise<ToolSet> {
    return { ...(await this.mcp.load()), ...this.build() };
  }

  build(): ToolSet {
    return {
      [AssistantTools.SENSITIVE_TOOL]: tool({
        description: 'Permanently delete an article. Destructive.',
        inputSchema: jsonSchema<{ id: number }>({
          type: 'object',
          properties: { id: { type: 'number', description: 'Article id to delete' } },
          required: ['id'],
        }),
        // The demo deletes nothing; what it demonstrates is the approval that gates the call.
        execute: ({ id }) => Promise.resolve({ deleted: id }),
      }),
      appFeatures: tool({
        description: "The demo application's enabled feature flags and selected adapters.",
        inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
        execute: () => Promise.resolve(this.config.getOrThrow<Record<string, unknown>>('features')),
      }),
      fetchArticle: tool({
        description: 'Fetch one article from the external blog API by its id.',
        inputSchema: jsonSchema<{ id: number }>({
          type: 'object',
          properties: { id: { type: 'number', description: 'Article id, between 1 and 100' } },
          required: ['id'],
        }),
        execute: async ({ id }) => {
          const response = await fetch(`${ARTICLE_API}/${id}`);
          if (!response.ok) throw new Error(`article ${id} not found (HTTP ${response.status})`);
          const article = (await response.json()) as ExternalPost;
          return { id: article.id, title: article.title, body: article.body };
        },
      }),
    };
  }
}
