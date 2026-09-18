import { ClsServiceManager } from 'nestjs-cls';
import {
  HTTP_ENTRYPOINT_TYPE,
  getCollectorEntries,
  setProfileContext,
} from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import { AiProfilerTelemetry, configureAiCapture } from './ai-telemetry';
import { AI_ENTRIES_KEY } from './ai-call.interface';
import type { AiCallEntry, AiEntry } from './ai-call.interface';

function newProfile(type: string = HTTP_ENTRYPOINT_TYPE): Profile {
  return {
    token: 't',
    traceId: 'tr',
    createdAt: Date.now(),
    entrypoint: { type, data: { method: 'POST', url: '/chat' } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

async function withProfile(profile: Profile, work: () => void): Promise<void> {
  const cls = ClsServiceManager.getClsService();
  await cls.run(async () => {
    setProfileContext(cls, profile);
    await Promise.resolve(work());
  });
}

const entriesOf = (p: Profile): AiEntry[] => getCollectorEntries<AiEntry>(p, AI_ENTRIES_KEY);
const firstCall = (p: Profile): AiCallEntry | undefined =>
  entriesOf(p).find((e): e is AiCallEntry => e.kind === 'call');

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
describe('AiProfilerTelemetry — edges', () => {
  let telemetry: AiProfilerTelemetry;

  beforeEach(() => {
    telemetry = new AiProfilerTelemetry();
    configureAiCapture({ captureContent: true, maxTextLength: 2000, maxMessages: 40 });
  });

  /** Records one call from `start`, then ends it with `end`. */
  async function record(start: object, end: object): Promise<Profile> {
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onLanguageModelCallStart?.({
        callId: 'c',
        provider: 'p',
        modelId: 'm',
        messages: [],
        ...start,
      } as any);
      telemetry.onLanguageModelCallEnd?.({
        callId: 'c',
        provider: 'p',
        modelId: 'm',
        finishReason: 'stop',
        usage: {
          inputTokens: undefined,
          inputTokenDetails: {
            noCacheTokens: undefined,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
          },
          outputTokens: undefined,
          outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
          totalTokens: undefined,
        },
        content: [],
        responseId: '',
        performance: {
          responseTimeMs: 1,
          effectiveOutputTokensPerSecond: 1,
          outputTokensPerSecond: undefined,
          inputTokensPerSecond: undefined,
          effectiveTotalTokensPerSecond: 1,
          timeToFirstOutputMs: undefined,
        },
        ...end,
      } as any);
    });
    return profile;
  }

  it('omits usage, settings and response id when the provider reports none', async () => {
    const call = firstCall(await record({}, {}));

    expect(call?.usage).toBeUndefined();
    expect(call?.settings).toBeUndefined();
    expect(call?.responseId).toBeUndefined();
    expect(call?.timeToFirstOutput).toBeUndefined();
    expect(call?.outputTokensPerSecond).toBeUndefined();
  });

  it('names a tool with no name, description or schema', async () => {
    const call = firstCall(await record({ tools: [{ type: 'function' }, 'not an object'] }, {}));

    expect(call?.tools).toEqual([{ name: 'unknown', origin: 'local' }]);
  });

  it('flattens instructions given as a list of messages', async () => {
    const call = firstCall(
      await record({ instructions: [{ content: 'first' }, 'second', { content: '' }] }, {}),
    );

    expect(call?.instructions).toBe('first\nsecond');
  });

  it('treats empty instructions as none', async () => {
    expect(firstCall(await record({ instructions: [] }, {}))?.instructions).toBeUndefined();
  });

  it('describes an attachment it cannot classify', async () => {
    const call = firstCall(
      await record(
        {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'file', data: { type: 'reference', reference: { openai: 'f-1' } } },
              ],
            },
          ],
        },
        {},
      ),
    );

    expect(call?.messages?.[0]?.parts?.[0]).toEqual({
      type: 'file',
      value: { openai: 'f-1' },
    });
  });

  it('records the size of an ArrayBuffer attachment', async () => {
    const call = firstCall(
      await record(
        {
          messages: [
            {
              role: 'user',
              content: [{ type: 'file', mediaType: 'audio/wav', data: new ArrayBuffer(16) }],
            },
          ],
        },
        {},
      ),
    );

    expect(call?.messages?.[0]?.parts?.[0]).toEqual({
      type: 'file',
      mediaType: 'audio/wav',
      bytes: 16,
    });
  });

  it('records a granted approval and an automatic one', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onStart?.({ callId: 'c', operationId: 'ai.generateText' } as any);
      telemetry.onLanguageModelCallStart?.({
        callId: 'c',
        provider: 'p',
        modelId: 'm',
        messages: [],
      } as any);
      telemetry.onLanguageModelCallEnd?.({
        callId: 'c',
        provider: 'p',
        modelId: 'm',
        finishReason: 'stop',
        usage: {
          inputTokens: 1,
          inputTokenDetails: {},
          outputTokens: 1,
          outputTokenDetails: {},
          totalTokens: 2,
        },
        content: [],
        responseId: '',
        performance: {
          responseTimeMs: 1,
          effectiveOutputTokensPerSecond: 1,
          effectiveTotalTokensPerSecond: 1,
        },
      } as any);
      telemetry.onEnd?.({
        callId: 'c',
        content: [
          {
            type: 'tool-approval-response',
            approvalId: 'a1',
            approved: true,
            toolCall: { toolName: 'go' },
          },
          { type: 'tool-approval-request', approvalId: 'a2', isAutomatic: true, toolCall: {} },
        ],
      } as any);
    });

    expect(firstCall(profile)?.approvals).toEqual([
      { approvalId: 'a1', tool: 'go', decision: 'approved' },
      { approvalId: 'a2', tool: 'unknown', decision: 'requested', automatic: true },
    ]);
  });

  it('synthesizes a call with unknown provider and model when the operation named none', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onStart?.({ callId: 'o', operationId: 'ai.embed' } as any);
      telemetry.onEnd?.({ callId: 'o' } as any);
    });

    expect(firstCall(profile)).toMatchObject({
      operation: 'ai.embed',
      provider: 'unknown',
      model: 'unknown',
      step: 0,
    });
  });

  it('leaves a non-HTTP profile in its own kind', async () => {
    const profile = newProfile('command');
    await withProfile(profile, () => {
      telemetry.onLanguageModelCallStart?.({
        callId: 'c',
        provider: 'p',
        modelId: 'm',
        messages: [],
      } as any);
      telemetry.onLanguageModelCallEnd?.({
        callId: 'c',
        provider: 'p',
        modelId: 'm',
        finishReason: 'stop',
        usage: {
          inputTokens: 1,
          inputTokenDetails: {},
          outputTokens: 1,
          outputTokenDetails: {},
          totalTokens: 2,
        },
        content: [],
        responseId: '',
        performance: {
          responseTimeMs: 1,
          effectiveOutputTokensPerSecond: 1,
          effectiveTotalTokensPerSecond: 1,
        },
      } as any);
    });

    expect(profile.entrypoint.type).toBe('command');
    expect(entriesOf(profile)).toHaveLength(1);
  });

  it('times a tool execution it never saw start', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onToolExecutionEnd?.({
        callId: 'c',
        toolExecutionMs: 7,
        toolCall: { toolCallId: 'unseen', toolName: 'late', input: {}, providerExecuted: true },
        toolOutput: { type: 'tool-result', output: 1 },
      } as any);
    });

    expect(entriesOf(profile)[0]).toMatchObject({ kind: 'tool', name: 'late', origin: 'provider' });
  });
});
