import { ClsServiceManager } from 'nestjs-cls';
import {
  HTTP_ENTRYPOINT_TYPE,
  getCollectorEntries,
  setProfileContext,
} from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import { AiProfilerTelemetry } from './ai-telemetry';
import { configureAiCapture, resetAiCapture } from './ai-capture';
import { AI_ENTRIES_KEY } from './ai-call.interface';
import type {
  AiCallEntry,
  AiEntry,
  AiMessagePart,
  AiToolExecutionEntry,
} from './ai-call.interface';

function newProfile(): Profile {
  return {
    token: 't',
    traceId: 'tr',
    createdAt: Date.now(),
    entrypoint: { type: HTTP_ENTRYPOINT_TYPE, data: { method: 'POST', url: '/chat' } },
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

const USAGE = {
  inputTokens: 1,
  inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: undefined, cacheWriteTokens: undefined },
  outputTokens: 1,
  outputTokenDetails: { textTokens: 1, reasoningTokens: undefined },
  totalTokens: 2,
};
const PERFORMANCE = {
  responseTimeMs: 10,
  effectiveOutputTokensPerSecond: 1,
  outputTokensPerSecond: undefined,
  inputTokensPerSecond: undefined,
  effectiveTotalTokensPerSecond: 1,
  timeToFirstOutputMs: undefined,
};

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
describe('AiProfilerTelemetry — message parts', () => {
  let telemetry: AiProfilerTelemetry;

  beforeEach(() => {
    telemetry = new AiProfilerTelemetry();
    resetAiCapture();
  });

  /** Records one call whose prompt carries `messages`, and returns the captured parts. */
  async function partsOf(messages: unknown[]): Promise<AiMessagePart[]> {
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onLanguageModelCallStart?.({
        callId: 'c1',
        provider: 'p',
        modelId: 'm',
        messages,
      } as any);
      telemetry.onLanguageModelCallEnd?.({
        callId: 'c1',
        provider: 'p',
        modelId: 'm',
        finishReason: 'stop',
        usage: USAGE,
        content: [],
        responseId: '',
        performance: PERFORMANCE,
      } as any);
    });
    return firstCall(profile)?.messages?.[0]?.parts ?? [];
  }

  it('describes an attachment carried by URL without recording it', async () => {
    const parts = await partsOf([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          {
            type: 'file',
            mediaType: 'image/png',
            filename: 'logo.png',
            data: new URL('https://e.test/a.png'),
          },
        ],
      },
    ]);

    expect(parts).toEqual([
      { type: 'file', name: 'logo.png', mediaType: 'image/png', url: 'https://e.test/a.png' },
    ]);
  });

  it('describes an attachment carried as a tagged url', async () => {
    const parts = await partsOf([
      {
        role: 'user',
        content: [
          {
            type: 'file',
            mediaType: 'application/pdf',
            data: { type: 'url', url: new URL('https://e.test/a.pdf') },
          },
        ],
      },
    ]);

    expect(parts[0]).toMatchObject({
      type: 'file',
      mediaType: 'application/pdf',
      url: 'https://e.test/a.pdf',
    });
  });

  it('records the size of inline bytes, never the bytes', async () => {
    const parts = await partsOf([
      {
        role: 'user',
        content: [{ type: 'file', mediaType: 'image/png', data: new Uint8Array(64) }],
      },
    ]);

    expect(parts[0]).toEqual({ type: 'file', mediaType: 'image/png', bytes: 64 });
  });

  it('records a base64 attachment by size, and a data URL by both', async () => {
    const [inline] = await partsOf([
      { role: 'user', content: [{ type: 'file', mediaType: 'image/png', data: 'AAAABBBB' }] },
    ]);
    const [dataUrl] = await partsOf([
      {
        role: 'user',
        content: [{ type: 'file', mediaType: 'image/png', data: 'data:image/png;base64,AAAA' }],
      },
    ]);

    expect(inline).toEqual({ type: 'file', mediaType: 'image/png', bytes: 8 });
    expect(dataUrl).toMatchObject({ type: 'file', url: 'data:image/png;base64,AAAA', bytes: 26 });
  });

  it('unwraps a tool result and keeps the tool name', async () => {
    const parts = await partsOf([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolName: 'shout',
            output: { type: 'json', value: { text: 'A' } },
          },
        ],
      },
    ]);

    expect(parts).toEqual([{ type: 'tool-result', name: 'shout', value: { text: 'A' } }]);
  });

  it('keeps an approval decision beside its reason', async () => {
    const parts = await partsOf([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-approval-response',
            approvalId: 'a1',
            approved: false,
            reason: 'denied by operator',
          },
        ],
      },
    ]);

    expect(parts).toEqual([
      { type: 'tool-approval-response', value: { approved: false, reason: 'denied by operator' } },
    ]);
  });

  it('flattens a plain string message', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onLanguageModelCallStart?.({
        callId: 'c1',
        provider: 'p',
        modelId: 'm',
        messages: [{ role: 'system', content: 'Be terse' }],
      } as any);
      telemetry.onLanguageModelCallEnd?.({
        callId: 'c1',
        provider: 'p',
        modelId: 'm',
        finishReason: 'stop',
        usage: USAGE,
        content: [],
        responseId: '',
        performance: PERFORMANCE,
      } as any);
    });

    expect(firstCall(profile)?.messages).toEqual([{ role: 'system', text: 'Be terse' }]);
  });

  it('keeps only the most recent messages', async () => {
    configureAiCapture({ maxMessages: 2 });
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onLanguageModelCallStart?.({
        callId: 'c1',
        provider: 'p',
        modelId: 'm',
        messages: [
          { role: 'user', content: 'one' },
          { role: 'assistant', content: 'two' },
          { role: 'user', content: 'three' },
        ],
      } as any);
      telemetry.onLanguageModelCallEnd?.({
        callId: 'c1',
        provider: 'p',
        modelId: 'm',
        finishReason: 'stop',
        usage: USAGE,
        content: [],
        responseId: '',
        performance: PERFORMANCE,
      } as any);
    });

    expect(firstCall(profile)?.messages?.map((m) => m.text)).toEqual(['two', 'three']);
  });

  it('records the model reasoning as its own field', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onLanguageModelCallStart?.({
        callId: 'c1',
        provider: 'p',
        modelId: 'm',
        messages: [],
      } as any);
      telemetry.onLanguageModelCallEnd?.({
        callId: 'c1',
        provider: 'p',
        modelId: 'm',
        finishReason: 'stop',
        usage: USAGE,
        content: [
          { type: 'reasoning', text: 'thinking' },
          { type: 'text', text: 'answer' },
        ],
        responseId: '',
        performance: PERFORMANCE,
      } as any);
    });

    expect(firstCall(profile)).toMatchObject({ reasoning: 'thinking', completion: 'answer' });
  });

  it('records a failed tool execution as an error', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onToolExecutionEnd?.({
        callId: 'c1',
        toolExecutionMs: 3,
        toolCall: { toolCallId: 'tc1', toolName: 'boom', input: {} },
        toolOutput: { type: 'tool-error', error: new Error('kaboom') },
      } as any);
    });

    const [execution] = entriesOf(profile) as AiToolExecutionEntry[];
    expect(execution).toMatchObject({ name: 'boom', origin: 'local' });
    expect(execution?.error).toContain('kaboom');
    expect(execution?.output).toBeUndefined();
  });

  it('survives a payload that cannot be serialized', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    const profile = newProfile();

    await withProfile(profile, () => {
      telemetry.onToolExecutionEnd?.({
        callId: 'c1',
        toolExecutionMs: 1,
        toolCall: { toolCallId: 'tc1', toolName: 'loop', input: cyclic },
        toolOutput: { type: 'tool-result', output: 'ok' },
      } as any);
    });

    // Masking walks the payload and breaks the cycle on the way, so the shape survives it.
    expect((entriesOf(profile)[0] as AiToolExecutionEntry).input).toEqual({
      self: '[Circular]',
    });
  });

  it('survives a payload that cannot be serialized when nothing is masked', async () => {
    configureAiCapture({ capture: 'full' });
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    const profile = newProfile();

    await withProfile(profile, () => {
      telemetry.onToolExecutionEnd?.({
        callId: 'c1',
        toolExecutionMs: 1,
        toolCall: { toolCallId: 'tc1', toolName: 'loop', input: cyclic },
        toolOutput: { type: 'tool-result', output: 'ok' },
      } as any);
    });

    expect((entriesOf(profile)[0] as AiToolExecutionEntry).input).toBe('[unserializable]');
  });

  it('describes a warning that cannot be serialized', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    const profile = newProfile();

    await withProfile(profile, () => {
      telemetry.onStart?.({ callId: 'w1', operationId: 'ai.generateText' } as any);
      telemetry.onLanguageModelCallStart?.({
        callId: 'w1',
        provider: 'p',
        modelId: 'm',
        messages: [],
      } as any);
      telemetry.onLanguageModelCallEnd?.({
        callId: 'w1',
        provider: 'p',
        modelId: 'm',
        finishReason: 'stop',
        usage: USAGE,
        content: [],
        responseId: '',
        performance: PERFORMANCE,
      } as any);
      telemetry.onEnd?.({ callId: 'w1', warnings: [cyclic] } as any);
    });

    expect(firstCall(profile)?.warnings).toEqual(['unknown warning']);
  });

  it('keeps the reasoning an operation reports, and drops it when content capture is off', async () => {
    const record = async (captureContent: boolean): Promise<string | undefined> => {
      configureAiCapture({ captureContent });
      const profile = newProfile();
      await withProfile(profile, () => {
        telemetry.onStart?.({
          callId: 'r1',
          operationId: 'ai.generateObject',
          provider: 'p',
          modelId: 'm',
        } as any);
        telemetry.onEnd?.({
          callId: 'r1',
          reasoning: 'because',
          usage: USAGE,
          finishReason: 'stop',
        } as any);
      });
      return firstCall(profile)?.reasoning;
    };

    expect(await record(true)).toBe('because');
    expect(await record(false)).toBeUndefined();
  });

  it('ignores content parts that are not approvals', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onStart?.({ callId: 'a1', operationId: 'ai.generateText' } as any);
      telemetry.onLanguageModelCallStart?.({
        callId: 'a1',
        provider: 'p',
        modelId: 'm',
        messages: [],
      } as any);
      telemetry.onLanguageModelCallEnd?.({
        callId: 'a1',
        provider: 'p',
        modelId: 'm',
        finishReason: 'stop',
        usage: USAGE,
        content: [],
        responseId: '',
        performance: PERFORMANCE,
      } as any);
      telemetry.onEnd?.({
        callId: 'a1',
        content: ['not an object', { type: 'text', text: 'hi' }],
      } as any);
    });

    expect(firstCall(profile)?.approvals).toBeUndefined();
  });

  it('records an unrecoverable SDK error as a failed call', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onError?.(new Error('provider exploded'));
    });

    expect(firstCall(profile)).toMatchObject({
      provider: 'unknown',
      model: 'unknown',
      error: 'provider exploded',
    });
  });

  it('attributes a failed call to the operation it belonged to', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onStart?.({
        callId: 'a1',
        operationId: 'ai.streamText',
        provider: 'openai',
        modelId: 'gpt-4o-mini',
        system: 'Be brief.',
        messages: [{ role: 'user', content: 'hi' }],
      } as any);
      telemetry.onLanguageModelCallStart?.({
        callId: 'a1',
        messages: [{ role: 'user', content: 'hi' }],
      } as any);
      telemetry.onError?.({
        callId: 'a1',
        error: { name: 'AI_APICallError', message: 'Incorrect API key provided', statusCode: 401 },
      });
    });

    expect(firstCall(profile)).toMatchObject({
      callId: 'a1',
      operation: 'ai.streamText',
      provider: 'openai',
      model: 'gpt-4o-mini',
      instructions: 'Be brief.',
      error: 'Incorrect API key provided',
    });
  });

  it('serialises an error object that carries no message', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onError?.({ callId: 'a1', error: { code: 'ECONNRESET' } });
    });

    expect(firstCall(profile)?.error).toBe('{"code":"ECONNRESET"}');
  });

  it('describes an error that cannot be serialised, and one that is not an object', async () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onError?.({ callId: 'a1', error: circular });
      telemetry.onError?.({ callId: 'a2', error: 'plain failure' });
      telemetry.onError?.('not even an event');
    });

    const errors = entriesOf(profile)
      .filter((entry): entry is AiCallEntry => entry.kind === 'call')
      .map((entry) => entry.error);
    expect(errors).toEqual(['unknown error', 'plain failure', 'not even an event']);
  });
});
