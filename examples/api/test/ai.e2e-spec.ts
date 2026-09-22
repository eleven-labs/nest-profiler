import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { Profile, ResponseStreamData } from '@eleven-labs/nest-profiler';
import { createE2EApp, getProfile, profileOf, server, tokenOf } from './helpers/app.js';
import { startTestMcpServer } from './helpers/mcp-server.js';
import type { TestMcpServer } from './helpers/mcp-server.js';
import { LANGUAGE_MODEL } from '../src/ai/domain/assistant.js';
import { configureAiPricing, isAiCall, resetAiPricing } from '@eleven-labs/nest-profiler-ai';
import type {
  AiCallEntry,
  AiCollectorData,
  AiToolExecutionEntry,
} from '@eleven-labs/nest-profiler-ai';

/**
 * The AI context, profiled end to end against a mock model — no OpenRouter key and no network, so
 * this runs anywhere. It pins the two things the feature exists for: the AI panel is filled from
 * the AI SDK's own telemetry (nothing in the controller or the service knows the profiler exists),
 * and a streamed answer is measured over the whole stream instead of over the microsecond it took
 * to open it.
 */

const TOKENS = ['Web ', 'profilers ', 'show ', 'what ', 'a ', 'request ', 'did.'];
const ANSWER = TOKENS.join('');
const CHUNK_DELAY_MS = 15;

const USAGE = {
  inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 7, text: 7, reasoning: undefined },
};
const FINISH = { unified: 'stop' as const, raw: 'stop' };

/**
 * Answers with a `fetchArticle` tool call the first time and with text afterwards, which is what
 * drives the two-step loop `POST /ai/agent` exercises.
 */
let generateCalls = 0;
/** Which tool the mock asks for on its first call; `undefined` answers with text straight away. */
let requestedTool: string | undefined = 'fetchArticle';
/** The JSON input the mock sends with that tool call. */
let requestedInput = '{"id":1}';

const DIGEST = {
  title: 'Web profilers',
  summary: 'They show what a request did.',
  topics: ['profiling'],
  sentiment: 'neutral',
};

const mockModel = new MockLanguageModelV4({
  // Without this the SDK downloads the attachment to inline it, as it does for a model that
  // cannot take a URL — and the demo host does not resolve.
  supportedUrls: { '*/*': [/^https?:\/\//] },
  doGenerate: (options) => {
    generateCalls += 1;
    const wantsJson = options.responseFormat?.type === 'json';
    const wantsTool = generateCalls === 1 && requestedTool !== undefined && !wantsJson;
    return Promise.resolve({
      content: wantsTool
        ? [
            {
              type: 'tool-call' as const,
              toolCallId: 'call-1',
              toolName: requestedTool as string,
              input: requestedInput,
            },
          ]
        : [{ type: 'text' as const, text: wantsJson ? JSON.stringify(DIGEST) : ANSWER }],
      finishReason: wantsTool ? { unified: 'tool-calls' as const, raw: 'tool_calls' } : FINISH,
      usage: USAGE,
      warnings: [],
    });
  },
  doStream: () =>
    Promise.resolve({
      stream: simulateReadableStream({
        chunkDelayInMs: CHUNK_DELAY_MS,
        chunks: [
          { type: 'stream-start' as const, warnings: [] },
          { type: 'text-start' as const, id: '0' },
          ...TOKENS.map((delta) => ({ type: 'text-delta' as const, id: '0', delta })),
          { type: 'text-end' as const, id: '0' },
          {
            type: 'finish' as const,
            finishReason: FINISH,
            usage: {
              inputTokens: USAGE.inputTokens,
              outputTokens: { total: TOKENS.length, text: TOKENS.length, reasoning: undefined },
            },
          },
        ],
      }),
    }),
});

const aiPanel = (profile: Profile): AiCollectorData => profile.collectors['ai'] as AiCollectorData;
const callsOf = (panel: AiCollectorData): AiCallEntry[] => panel.entries.filter(isAiCall);
const toolsOf = (panel: AiCollectorData): AiToolExecutionEntry[] =>
  panel.entries.filter((entry): entry is AiToolExecutionEntry => entry.kind === 'tool');

describe('AI assistant (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2EApp([{ token: LANGUAGE_MODEL, value: mockModel }]);
  });

  beforeEach(() => {
    generateCalls = 0;
    requestedTool = 'fetchArticle';
    requestedInput = '{"id":1}';
  });

  afterAll(async () => await app.close());

  describe('POST /ai/ask — no streaming', () => {
    it('answers and records the model call in the AI panel', async () => {
      const { res, profile } = await profileOf(app, 'post', '/api/v1/ai/ask', {
        prompt: 'What is a web profiler?',
      });

      expect(res.status).toBe(201);
      const panel = aiPanel(profile);
      const [call] = callsOf(panel);
      expect(panel.callCount).toBe(1);
      expect(call?.operation).toBe('ai.generateText');
      expect(call?.step).toBe(0);
      expect(panel.totalTokens).toBe(19);
    });

    it('records the system prompt apart from the conversation', async () => {
      const { profile } = await profileOf(app, 'post', '/api/v1/ai/ask', {
        prompt: 'What is a web profiler?',
      });
      const [call] = callsOf(aiPanel(profile));

      expect(call?.instructions).toContain('NestJS profiler demo');
      expect(call?.messages).toEqual([{ role: 'user', text: 'What is a web profiler?' }]);
    });

    it('records the sampling settings the call was made with', async () => {
      const { profile } = await profileOf(app, 'post', '/api/v1/ai/ask', { prompt: 'Hello there' });
      const [call] = callsOf(aiPanel(profile));

      expect(call?.settings?.temperature).toBe(0.7);
      expect(call?.settings?.maxOutputTokens).toBe(512);
    });

    it('is not reported as a streamed response', async () => {
      const { profile } = await profileOf(app, 'post', '/api/v1/ai/ask', { prompt: 'Hello there' });

      expect(profile.response?.stream).toBeUndefined();
    });
  });

  describe('cost', () => {
    afterEach(() => resetAiPricing());

    it('leaves the cost unknown while no model is priced', async () => {
      const { profile } = await profileOf(app, 'post', '/api/v1/ai/ask', { prompt: 'Hello there' });
      const panel = aiPanel(profile);

      // Unknown, which the panel must not print as free.
      expect(panel.costKnown).toBe(false);
      expect(callsOf(panel)[0]?.cost).toBeUndefined();
    });

    it('costs the call from the configured token prices', async () => {
      configureAiPricing({ table: { 'mock-provider:mock-model-id': { input: 3, output: 15 } } });

      const { profile } = await profileOf(app, 'post', '/api/v1/ai/ask', { prompt: 'Hello there' });
      const panel = aiPanel(profile);

      // 12 input tokens at $3/M, 7 output at $15/M.
      const expected = (12 * 3 + 7 * 15) / 1_000_000;
      expect(callsOf(panel)[0]).toMatchObject({ cost: expected, costSource: 'estimated' });
      expect(panel).toMatchObject({ totalCost: expected, costKnown: true, costEstimated: true });
    });

    it('costs every step of a tool loop', async () => {
      configureAiPricing({ table: { 'mock-model-id': { input: 3, output: 15 } } });

      const { profile } = await profileOf(app, 'post', '/api/v1/ai/agent', {
        prompt: 'Summarise article 1',
      });
      const panel = aiPanel(profile);

      expect(panel.callCount).toBe(2);
      expect(panel.totalCost).toBeCloseTo((2 * (12 * 3 + 7 * 15)) / 1_000_000, 9);
    });
  });

  describe('POST /ai/agent — tool loop', () => {
    it('records one model call per round trip', async () => {
      const { res, profile } = await profileOf(app, 'post', '/api/v1/ai/agent', {
        prompt: 'Summarise article 1.',
      });

      expect(res.status).toBe(201);
      const calls = callsOf(aiPanel(profile));
      expect(calls).toHaveLength(2);
      expect(calls.map((call) => call.step)).toEqual([0, 1]);
      expect(calls[0]?.finishReason).toBe('tool-calls');
      expect(calls[0]?.toolCalls).toEqual([
        { id: 'call-1', name: 'fetchArticle', input: { id: 1 }, origin: 'local' },
      ]);
    });

    it('records the tools declared, with the schema the model had to fill', async () => {
      const { profile } = await profileOf(app, 'post', '/api/v1/ai/agent', {
        prompt: 'Summarise article 1.',
      });
      const [call] = callsOf(aiPanel(profile));

      expect(call?.tools?.map((tool) => tool.name).sort()).toEqual([
        'appFeatures',
        'deleteArticle',
        'fetchArticle',
      ]);
      expect(call?.tools?.find((tool) => tool.name === 'fetchArticle')?.inputSchema).toMatchObject({
        properties: { id: { type: 'number' } },
      });
    });

    it('records the tool execution with its input, output and duration', async () => {
      const { profile } = await profileOf(app, 'post', '/api/v1/ai/agent', {
        prompt: 'Summarise article 1.',
      });
      const panel = aiPanel(profile);
      const [execution] = toolsOf(panel);

      expect(panel.toolCount).toBe(1);
      expect(execution?.name).toBe('fetchArticle');
      expect(execution?.origin).toBe('local');
      expect(execution?.input).toEqual({ id: 1 });
      expect(execution?.output).toMatchObject({ id: 1 });
      expect(execution?.duration).toBeGreaterThan(0);
    });

    it('grows the conversation across steps, ending with the tool result', async () => {
      const { profile } = await profileOf(app, 'post', '/api/v1/ai/agent', {
        prompt: 'Summarise article 1.',
      });
      const calls = callsOf(aiPanel(profile));

      expect(calls[0]?.messages).toHaveLength(1);
      expect(calls[1]?.messages?.map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'tool',
      ]);
      expect(calls[1]?.messages?.[2]?.parts?.[0]).toMatchObject({
        type: 'tool-result',
        name: 'fetchArticle',
      });
    });

    it('draws every model call and tool execution on the trace', async () => {
      const { profile } = await profileOf(app, 'post', '/api/v1/ai/agent', {
        prompt: 'Summarise article 1.',
      });

      const labels = (profile.trace ?? [])
        .filter((span) => span.kind === 'ai')
        .map((span) => span.label);
      expect(labels).toHaveLength(3);
      expect(labels).toContain('tool fetchArticle');
    });
  });

  describe('AI SDK agents', () => {
    /**
     * What every entry of an agent run carries. The name is the agent's own `id` — the demo
     * declares it as an AI SDK setting and imports nothing from the profiler to get it recorded.
     */
    const SUPPORT = { id: 'support', name: 'support', framework: 'tool-loop' };

    describe('POST /ai/agent/run — ToolLoopAgent.generate', () => {
      it('records the loop the agent held, step by step', async () => {
        const { res, profile } = await profileOf(app, 'post', '/api/v1/ai/agent/run', {
          prompt: 'Summarise article 1.',
        });

        expect(res.status).toBe(201);
        const calls = callsOf(aiPanel(profile));
        expect(calls.map((call) => call.step)).toEqual([0, 1]);
        expect(calls[0]?.finishReason).toBe('tool-calls');
      });

      it('attributes every call and tool execution to the agent that ran them', async () => {
        const { profile } = await profileOf(app, 'post', '/api/v1/ai/agent/run', {
          prompt: 'Summarise article 1.',
        });
        const panel = aiPanel(profile);

        expect(panel.entries.length).toBeGreaterThan(1);
        for (const entry of panel.entries) expect(entry.agent).toEqual(SUPPORT);
      });

      it('indexes the agent, so the AI list can be narrowed to it', async () => {
        const agentRun = await profileOf(app, 'post', '/api/v1/ai/agent/run', {
          prompt: 'Summarise article 1.',
        });
        const plainCall = await profileOf(app, 'post', '/api/v1/ai/ask', { prompt: 'Hello there' });

        const list = await request(server(app))
          .get('/_profiler')
          .query({ view: 'ai', ai_aiAgent: 'support' });

        expect(list.status).toBe(200);
        expect(list.text).toContain(tokenOf(agentRun.res));
        expect(list.text).not.toContain(tokenOf(plainCall.res));
      });

      it('names the agent on the panel and on the list row', async () => {
        const { res } = await profileOf(app, 'post', '/api/v1/ai/agent/run', {
          prompt: 'Summarise article 1.',
        });

        const panel = await request(server(app))
          .get(`/_profiler/${tokenOf(res)}`)
          .query({ tab: 'ai' });
        const list = await request(server(app)).get('/_profiler').query({ view: 'ai' });

        expect(panel.status).toBe(200);
        // The badge in the panel, the badge on the list row, and the breadcrumb.
        expect(panel.text).toContain('agent · support');
        expect(panel.text).toContain('@support');
        expect(list.text).toContain('agent · support');
      });

      it('leaves a plain generateText call unattributed', async () => {
        const { profile } = await profileOf(app, 'post', '/api/v1/ai/ask', {
          prompt: 'Hello there',
        });

        expect(callsOf(aiPanel(profile))[0]?.agent).toBeUndefined();
      });
    });

    describe.each([
      ['POST /ai/agent/stream — pipeAgentUIStreamToResponse', '/api/v1/ai/agent/stream'],
      ['POST /ai/agent/ui — createAgentUIStreamResponse', '/api/v1/ai/agent/ui'],
    ])('%s', (_label, url) => {
      it('delivers a UI message stream and measures it to its last chunk', async () => {
        const res = await request(server(app))
          .post(url)
          .send({ prompt: 'What is a web profiler?' });
        const profile = await getProfile(app, tokenOf(res));

        expect(res.headers['content-type']).toContain('text/event-stream');
        // The UI protocol carries the answer as text deltas, not as one body.
        const deltas = [...res.text.matchAll(/"delta":"([^"]*)"/g)].map(([, d]) => d).join('');
        expect(deltas).toBe(ANSWER);
        const stream = profile.response?.stream as ResponseStreamData;
        expect(stream.aborted).toBe(false);
        expect(profile.performance.duration).toBeGreaterThanOrEqual(
          CHUNK_DELAY_MS * TOKENS.length * 0.5,
        );
      });

      it('keeps the model call the agent made after the handler returned, named', async () => {
        const res = await request(server(app))
          .post(url)
          .send({ prompt: 'What is a web profiler?' });
        const profile = await getProfile(app, tokenOf(res));

        const [call] = callsOf(aiPanel(profile));
        expect(call?.operation).toBe('ai.streamText');
        expect(call?.completion).toBe(ANSWER);
        expect(call?.agent).toEqual(SUPPORT);
      });
    });
  });

  describe('POST /ai/object — structured output', () => {
    it('answers with an object that satisfies the schema', async () => {
      const { res } = await profileOf(app, 'post', '/api/v1/ai/object', {
        prompt: 'Digest this: web profilers show what a request did.',
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ sentiment: 'neutral', topics: ['profiling'] });
    });

    it('records the schema the model had to satisfy and the object it returned', async () => {
      const { profile } = await profileOf(app, 'post', '/api/v1/ai/object', {
        prompt: 'Digest this: web profilers show what a request did.',
      });
      const [call] = callsOf(aiPanel(profile));

      expect(call?.operation).toBe('ai.generateObject');
      expect(call?.outputStrategy).toBe('object');
      expect(call?.schemaName).toBe('ArticleDigest');
      expect((call?.outputSchema as { required?: string[] } | undefined)?.required).toContain(
        'summary',
      );
      expect(call?.output).toMatchObject({ title: 'Web profilers' });
    });
  });

  describe('POST /ai/describe — attachments', () => {
    const attachment = {
      prompt: 'What is in this picture?',
      url: 'https://example.test/logo.png',
      mediaType: 'image/png',
    };

    it('records what was attached, never the bytes', async () => {
      const { res, profile } = await profileOf(app, 'post', '/api/v1/ai/describe', attachment);

      expect(res.status).toBe(201);
      const [call] = callsOf(aiPanel(profile));
      const parts = call?.messages?.[0]?.parts ?? [];
      expect(parts).toEqual([
        { type: 'file', mediaType: 'image/png', url: 'https://example.test/logo.png' },
      ]);
    });
  });

  describe('POST /ai/approval — human in the loop', () => {
    beforeEach(() => {
      requestedTool = 'deleteArticle';
    });

    it('stops at the approval request instead of running the tool', async () => {
      const { res, profile } = await profileOf(app, 'post', '/api/v1/ai/approval', {
        prompt: 'Delete article 1.',
      });

      expect(res.body).toMatchObject({ status: 'awaiting-approval', tool: 'deleteArticle' });
      const panel = aiPanel(profile);
      expect(panel.toolCount).toBe(0);
      expect(callsOf(panel)[0]?.approvals).toEqual([
        expect.objectContaining({ decision: 'requested', tool: 'deleteArticle' }),
      ]);
    });

    it('runs the tool once a decision comes back, and records the response', async () => {
      const { res } = await profileOf(app, 'post', '/api/v1/ai/approval', {
        prompt: 'Delete article 1.',
      });
      const { pendingId } = res.body as { pendingId: string };

      const resumed = await profileOf(app, 'post', `/api/v1/ai/approval/${pendingId}`, {
        approved: true,
      });

      const panel = aiPanel(resumed.profile);
      expect(panel.toolCount).toBe(1);
      expect(toolsOf(panel)[0]?.name).toBe('deleteArticle');
      expect(callsOf(panel)[0]?.messages?.some((message) => message.role === 'tool')).toBe(true);
    });

    it('does not run the tool when the decision is a denial', async () => {
      const { res } = await profileOf(app, 'post', '/api/v1/ai/approval', {
        prompt: 'Delete article 1.',
      });
      const { pendingId } = res.body as { pendingId: string };

      const resumed = await profileOf(app, 'post', `/api/v1/ai/approval/${pendingId}`, {
        approved: false,
      });

      expect(aiPanel(resumed.profile).toolCount).toBe(0);
    });

    it('404s on an unknown pending approval', async () => {
      const { res } = await profileOf(app, 'post', '/api/v1/ai/approval/does-not-exist', {
        approved: true,
      });

      expect(res.status).toBe(404);
    });
  });

  describe('MCP tools', () => {
    describe('against a real MCP server', () => {
      let mcp: TestMcpServer;
      let connected: INestApplication;

      beforeAll(async () => {
        mcp = await startTestMcpServer();
        process.env['AI_MCP_URL'] = mcp.url;
        connected = await createE2EApp([{ token: LANGUAGE_MODEL, value: mockModel }]);
      });

      afterAll(async () => {
        delete process.env['AI_MCP_URL'];
        await connected.close();
        await mcp.close();
      });

      beforeEach(() => {
        requestedTool = 'shout';
        requestedInput = '{"text":"profiler"}';
      });

      it("declares the server's tools beside the application's own", async () => {
        const { profile } = await profileOf(connected, 'post', '/api/v1/ai/agent', {
          prompt: 'Shout the word profiler.',
        });
        const [call] = callsOf(aiPanel(profile));

        expect(call?.tools?.map((tool) => tool.name)).toContain('shout');
        expect(call?.tools?.find((tool) => tool.name === 'shout')?.origin).toBe('mcp');
        expect(call?.tools?.find((tool) => tool.name === 'appFeatures')?.origin).toBe('local');
      });

      it('runs an MCP tool and labels its origin', async () => {
        const { profile } = await profileOf(connected, 'post', '/api/v1/ai/agent', {
          prompt: 'Shout the word profiler.',
        });
        const panel = aiPanel(profile);
        const [execution] = toolsOf(panel);

        expect(execution?.name).toBe('shout');
        expect(execution?.origin).toBe('mcp');
        expect(execution?.input).toEqual({ text: 'profiler' });
        expect(JSON.stringify(execution?.output)).toContain('PROFILER');
        expect(callsOf(panel)[0]?.toolCalls?.[0]?.origin).toBe('mcp');
      });
    });

    describe('the endpoint the app serves itself', () => {
      const INITIALIZE = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'e2e', version: '1.0.0' },
        },
      };

      it('answers on /mcp, outside the API prefix', async () => {
        const res = await request(server(app)).post('/mcp').send(INITIALIZE);

        expect(res.status).toBe(200);
        expect(res.text).toContain('serverInfo');
      });
    });

    it('degrades to the local tools when the configured server is unreachable', async () => {
      process.env['AI_MCP_URL'] = 'http://127.0.0.1:9/mcp';
      const isolated = await createE2EApp([{ token: LANGUAGE_MODEL, value: mockModel }]);
      try {
        const res = await request(server(isolated))
          .post('/api/v1/ai/agent')
          .send({ prompt: 'Summarise article 1.' });

        expect(res.status).toBe(201);
      } finally {
        delete process.env['AI_MCP_URL'];
        await isolated.close();
      }
    });
  });

  describe('POST /ai/stream — raw chunks', () => {
    it('streams the answer and measures the whole stream', async () => {
      const res = await request(server(app))
        .post('/api/v1/ai/stream')
        .send({ prompt: 'What is a web profiler?' });
      const profile = await getProfile(app, tokenOf(res));

      expect(res.text).toBe(ANSWER);
      const stream = profile.response?.stream as ResponseStreamData;
      expect(stream.chunks).toBeGreaterThanOrEqual(TOKENS.length);
      expect(stream.aborted).toBe(false);
      // Opening the stream takes microseconds; producing it takes the chunk delays.
      expect(profile.performance.duration).toBeGreaterThanOrEqual(
        CHUNK_DELAY_MS * TOKENS.length * 0.5,
      );
      expect(stream.timeToFirstChunk).toBeLessThan(profile.performance.duration ?? 0);
    });

    it('keeps the model call the stream made after the handler returned', async () => {
      const res = await request(server(app))
        .post('/api/v1/ai/stream')
        .send({ prompt: 'What is a web profiler?' });
      const profile = await getProfile(app, tokenOf(res));

      const [call] = callsOf(aiPanel(profile));
      expect(call?.operation).toBe('ai.streamText');
      expect(call?.timeToFirstOutput).toBeGreaterThan(0);
      expect(call?.completion).toBe(ANSWER);
    });
  });

  describe('GET /ai/sse — Server-Sent Events', () => {
    it('is profiled exactly like the raw stream', async () => {
      const res = await request(server(app))
        .get('/api/v1/ai/sse')
        .query({ prompt: 'What is a web profiler?' });
      const profile = await getProfile(app, tokenOf(res));

      const stream = profile.response?.stream as ResponseStreamData;
      expect(stream.contentType).toContain('text/event-stream');
      expect(stream.chunks).toBeGreaterThanOrEqual(TOKENS.length);
      expect(aiPanel(profile).callCount).toBe(1);
      expect(profile.performance.duration).toBeGreaterThanOrEqual(
        CHUNK_DELAY_MS * TOKENS.length * 0.5,
      );
    });
  });
});
