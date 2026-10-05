import type { INestApplication } from '@nestjs/common';
import { HarnessAgent } from '@ai-sdk/harness/agent';
import type { HarnessV1 } from '@ai-sdk/harness';
import { tool } from 'ai';
import { z } from 'zod';
import type { Profile } from '@eleven-labs/nest-profiler';
import { isAiCall } from '@eleven-labs/nest-profiler-ai';
import { HARNESS_OPERATION } from '@eleven-labs/nest-profiler-ai/harness';
import type {
  AiCallEntry,
  AiCollectorData,
  AiToolExecutionEntry,
} from '@eleven-labs/nest-profiler-ai';
import request from 'supertest';
import { createE2EApp, profileOf, server } from './helpers/app.js';

/**
 * The coding-agent context, profiled end to end — with the real `HarnessAgent` and the real local
 * sandbox, but Claude Code swapped for a scripted harness. No credential, no `claude` / `codex` CLI
 * and no network, so this runs anywhere. It pins what the feature exists for: a harness turn
 * lands in the AI panel, named after the agent, with the runtime's own tools told apart from the
 * host's — and nothing in the controller or the service knows the profiler exists.
 */

const USAGE = {
  inputTokens: { total: 40, noCache: 40, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 9, text: 9, reasoning: undefined },
};
const SUMMARY = 'I wrote slugify.ts following the house conventions.';
// The example's own agent declares no host tool; this one does, to pin that a tool the host runs
// is told apart from the runtime's built-ins.

type Emit = (part: unknown) => void;
type Submit = (result: { toolCallId: string; output: unknown }) => void;

/**
 * One scripted turn of a coding agent: it asks the host for `houseConventions`, writes a file with
 * its built-in `write` tool, then answers. The host tool's result comes back through
 * `submitToolResult`, as it would over the Claude Code bridge.
 */
function scriptedHarness(): HarnessV1 {
  return {
    specificationVersion: 'harness-v1',
    harnessId: 'claude-code',
    builtinTools: {},
    doStart: ({ sessionId }: { sessionId: string }) =>
      Promise.resolve({
        sessionId,
        isResume: false,
        doPromptTurn: ({ emit }: { emit: Emit }) => {
          let submit: Submit = () => undefined;
          const conventions = new Promise<void>((resolve) => {
            submit = () => resolve();
          });
          const done = (async () => {
            await Promise.resolve();
            emit({ type: 'stream-start', modelId: 'claude-haiku-4-5' });
            emit({
              type: 'tool-call',
              toolCallId: 'host-1',
              toolName: 'houseConventions',
              input: JSON.stringify({ language: 'typescript' }),
              providerExecuted: false,
            });
            await conventions;
            emit({
              type: 'tool-call',
              toolCallId: 'builtin-1',
              toolName: 'write',
              input: JSON.stringify({ path: 'slugify.ts' }),
              providerExecuted: true,
            });
            emit({
              type: 'tool-result',
              toolCallId: 'builtin-1',
              toolName: 'write',
              result: { written: 'slugify.ts' },
            });
            emit({ type: 'finish-step', finishReason: { unified: 'tool-calls' }, usage: USAGE });
            emit({ type: 'text-start', id: 't1' });
            emit({ type: 'text-delta', id: 't1', delta: SUMMARY });
            emit({ type: 'text-end', id: 't1' });
            emit({ type: 'finish-step', finishReason: { unified: 'stop' }, usage: USAGE });
            emit({ type: 'finish', finishReason: { unified: 'stop' }, totalUsage: USAGE });
          })();
          return Promise.resolve({
            submitToolResult: (result: { toolCallId: string; output: unknown }) => {
              submit(result);
              return Promise.resolve();
            },
            done,
          });
        },
        doCompact: () => Promise.resolve(),
        doContinueTurn: () => Promise.reject(new Error('not scripted')),
        doSuspendTurn: () => Promise.reject(new Error('not scripted')),
        doDetach: () => Promise.resolve({}),
        doStop: () => Promise.resolve({}),
        doDestroy: () => Promise.resolve(),
      }),
  } as unknown as HarnessV1;
}

const scriptedAgent = new HarnessAgent({
  id: 'coding-agent',
  harness: scriptedHarness(),
  tools: {
    houseConventions: tool({
      description: 'The conventions every file written in this workspace must follow.',
      inputSchema: z.object({ language: z.string() }),
      execute: () => Promise.resolve({ rules: ['Name files in kebab-case.'] }),
    }),
  },
});

const aiPanel = (profile: Profile): AiCollectorData => profile.collectors['ai'] as AiCollectorData;

describe('Coding agent (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2EApp([{ token: HarnessAgent, value: scriptedAgent }]);
  });

  afterAll(async () => await app.close());

  it('opens a conversation, then continues it turn after turn', async () => {
    const first = await profileOf(app, 'post', '/api/v1/coding-agent/sessions', {
      prompt: 'Write a slugify helper.',
    });
    expect(first.res.status).toBe(201);
    const { sessionId } = first.res.body as { sessionId: string };
    expect(sessionId).toEqual(expect.stringMatching(/.+/));
    // The whole turn: the host tool and the runtime's own, and the turn's total as the runtime
    // reports it on `finish`.
    expect(first.res.body).toMatchObject({
      model: 'claude-haiku-4-5',
      text: SUMMARY,
      finishReason: 'stop',
      steps: 2,
      tools: ['houseConventions', 'write'],
      usage: { inputTokens: 40, outputTokens: 9 },
    });

    const second = await profileOf(
      app,
      'post',
      `/api/v1/coding-agent/sessions/${sessionId}/messages`,
      { prompt: 'Now add a test for it.' },
    );
    expect(second.res.body).toMatchObject({ sessionId, text: SUMMARY });

    // Each turn is a profile of its own, attributed to the same agent.
    for (const { profile } of [first, second]) {
      expect(aiPanel(profile).entries.filter(isAiCall)[0]?.agent?.id).toBe('coding-agent');
    }

    await request(server(app)).delete(`/api/v1/coding-agent/sessions/${sessionId}`).expect(204);
    await request(server(app))
      .post(`/api/v1/coding-agent/sessions/${sessionId}/messages`)
      .send({ prompt: 'Still there?' })
      .expect(404);
  });

  it('records the turn in the AI panel, named after the agent and its harness', async () => {
    const { profile } = await profileOf(app, 'post', '/api/v1/coding-agent/sessions', {
      prompt: 'Write a slugify helper.',
    });

    expect(profile.entrypoint.type).toBe('ai');
    const calls: AiCallEntry[] = aiPanel(profile).entries.filter(isAiCall);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call).toMatchObject({
        operation: HARNESS_OPERATION,
        provider: 'harness:claude-code',
        model: 'claude-haiku-4-5',
        agent: { id: 'coding-agent', name: 'coding-agent', framework: 'harness:claude-code' },
      });
    }
    expect(calls[1]?.completion).toBe(SUMMARY);
  });

  it('tells the runtime’s own tools apart from the host’s', async () => {
    const { profile } = await profileOf(app, 'post', '/api/v1/coding-agent/sessions', {
      prompt: 'Write a slugify helper.',
    });

    const tools = aiPanel(profile).entries.filter(
      (entry): entry is AiToolExecutionEntry => entry.kind === 'tool',
    );
    expect(tools.map(({ name, origin }) => ({ name, origin }))).toEqual([
      { name: 'houseConventions', origin: 'local' },
      { name: 'write', origin: 'harness' },
    ]);
  });
});
