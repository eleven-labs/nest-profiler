import { ClsServiceManager } from 'nestjs-cls';
import {
  HTTP_ENTRYPOINT_TYPE,
  getCollectorEntries,
  setProfileContext,
} from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import {
  AiProfilerTelemetry,
  configureAiCapture,
  configureAiEntrypointPromotion,
} from './ai-telemetry';
import { AI_ENTRIES_KEY } from './ai-call.interface';
import type { AiCallEntry, AiEntry, AiToolExecutionEntry } from './ai-call.interface';
import { markMcpTools } from './mcp-tool-registry';
import { AI_ENTRYPOINT_TYPE } from './ai-entrypoint';
import { configureAiPricing, resetAiPricing } from './ai-pricing';

/** A bare profile, as the HTTP middleware would have opened it. */
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

const USAGE = {
  inputTokens: 12,
  inputTokenDetails: { noCacheTokens: 12, cacheReadTokens: 2, cacheWriteTokens: undefined },
  outputTokens: 5,
  outputTokenDetails: { textTokens: 5, reasoningTokens: 1 },
  totalTokens: 17,
};

const PERFORMANCE = {
  responseTimeMs: 1234.5678,
  effectiveOutputTokensPerSecond: 4,
  outputTokensPerSecond: 9.55,
  inputTokensPerSecond: undefined,
  effectiveTotalTokensPerSecond: 13,
  timeToFirstOutputMs: 321.9,
};

/** Runs `work` inside a CLS scope carrying `profile`, the way a profiled request does. */
async function withProfile(profile: Profile, work: () => void | Promise<void>): Promise<void> {
  const cls = ClsServiceManager.getClsService();
  await cls.run(async () => {
    setProfileContext(cls, profile);
    await work();
  });
}

const entriesOf = (profile: Profile): AiEntry[] =>
  getCollectorEntries<AiEntry>(profile, AI_ENTRIES_KEY);
const callsOf = (profile: Profile): AiCallEntry[] =>
  entriesOf(profile).filter((e): e is AiCallEntry => e.kind === 'call');

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
describe('AiProfilerTelemetry', () => {
  let telemetry: AiProfilerTelemetry;

  beforeEach(() => {
    telemetry = new AiProfilerTelemetry();
    configureAiCapture({ captureContent: true, maxTextLength: 2000, maxMessages: 40 });
    configureAiEntrypointPromotion(true);
  });

  const start = (callId = 'c1'): void => {
    telemetry.onStart?.({
      callId,
      operationId: 'ai.generateText',
      provider: 'openai',
      modelId: 'gpt-test',
      temperature: 0.4,
      maxOutputTokens: 256,
      system: 'You are terse.',
      messages: [{ role: 'user', content: 'Hello' }],
    } as any);
    telemetry.onLanguageModelCallStart?.({
      callId,
      provider: 'openai',
      modelId: 'gpt-test',
      instructions: 'You are terse.',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [{ type: 'function', name: 'shout', description: 'Shout', inputSchema: {} }],
      temperature: 0.4,
      maxOutputTokens: 256,
    } as any);
  };

  const end = (callId = 'c1', content: unknown[] = [{ type: 'text', text: 'Hi there' }]): void => {
    telemetry.onLanguageModelCallEnd?.({
      callId,
      provider: 'openai',
      modelId: 'gpt-test',
      finishReason: 'stop',
      usage: USAGE,
      content,
      responseId: 'resp-1',
      performance: PERFORMANCE,
    } as any);
  };

  it('records a model call with its usage, timings and content', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      start();
      end();
    });

    const [call] = callsOf(profile);
    expect(call).toMatchObject({
      operation: 'ai.generateText',
      provider: 'openai',
      model: 'gpt-test',
      step: 0,
      finishReason: 'stop',
      completion: 'Hi there',
      instructions: 'You are terse.',
      timeToFirstOutput: 322,
      outputTokensPerSecond: 9.6,
    });
    expect(call?.usage).toEqual({ input: 12, cacheRead: 2, output: 5, reasoning: 1, total: 17 });
    expect(call?.settings).toEqual({ temperature: 0.4, maxOutputTokens: 256 });
    expect(call?.messages).toEqual([{ role: 'user', text: 'Hello' }]);
  });

  it('promotes the profile to the ai entrypoint kind', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      start();
      end();
    });

    expect(profile.entrypoint.type).toBe(AI_ENTRYPOINT_TYPE);
  });

  it('leaves the entrypoint alone when promotion is off', async () => {
    configureAiEntrypointPromotion(false);
    const profile = newProfile();
    await withProfile(profile, () => {
      start();
      end();
    });

    expect(profile.entrypoint.type).toBe(HTTP_ENTRYPOINT_TYPE);
  });

  it('drops prompts and completions when content capture is off', async () => {
    configureAiCapture({ captureContent: false });
    const profile = newProfile();
    await withProfile(profile, () => {
      start();
      end();
    });

    const [call] = callsOf(profile);
    expect(call?.completion).toBeUndefined();
    expect(call?.messages).toBeUndefined();
    expect(call?.instructions).toBeUndefined();
    // The figures survive — that is the point of the switch.
    expect(call?.usage?.total).toBe(17);
    expect(call?.model).toBe('gpt-test');
  });

  it('truncates text past the configured bound', async () => {
    configureAiCapture({ maxTextLength: 10 });
    const profile = newProfile();
    await withProfile(profile, () => {
      start();
      end('c1', [{ type: 'text', text: 'x'.repeat(50) }]);
    });

    expect(callsOf(profile)[0]?.completion).toBe(`${'x'.repeat(10)}…`);
  });

  it('numbers the steps of a tool loop and records the tool between them', async () => {
    markMcpTools(['shout']);
    const profile = newProfile();

    await withProfile(profile, () => {
      start();
      end('c1', [
        { type: 'tool-call', toolCallId: 'tc1', toolName: 'shout', input: { text: 'a' } },
      ]);
      telemetry.onToolExecutionStart?.({ toolCall: { toolCallId: 'tc1' } } as any);
      telemetry.onToolExecutionEnd?.({
        callId: 'c1',
        toolExecutionMs: 12,
        toolCall: { toolCallId: 'tc1', toolName: 'shout', input: { text: 'a' }, dynamic: true },
        toolOutput: { type: 'tool-result', output: { text: 'A' } },
      } as any);
      telemetry.onLanguageModelCallStart?.({
        callId: 'c1',
        provider: 'openai',
        modelId: 'gpt-test',
        messages: [{ role: 'user', content: 'Hello' }],
      } as any);
      end();
    });

    const entries = entriesOf(profile);
    expect(entries.map((e) => e.kind)).toEqual(['call', 'tool', 'call']);
    expect(callsOf(profile).map((c) => c.step)).toEqual([0, 1]);

    const execution = entries[1] as AiToolExecutionEntry;
    expect(execution).toMatchObject({ name: 'shout', origin: 'mcp', duration: 12 });
    expect(callsOf(profile)[0]?.toolCalls?.[0]).toMatchObject({ name: 'shout', origin: 'mcp' });
  });

  it('labels a provider-run tool as such', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onStart?.({ callId: 'c2', operationId: 'ai.generateText' } as any);
      telemetry.onLanguageModelCallStart?.({
        callId: 'c2',
        provider: 'openai',
        modelId: 'gpt-test',
        messages: [],
        tools: [{ type: 'provider-defined', name: 'web_search' }],
      } as any);
      end('c2');
    });

    expect(callsOf(profile)[0]?.tools).toEqual([{ name: 'web_search', origin: 'provider' }]);
  });

  it('records an approval exchange from the operation result', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      start();
      end();
      telemetry.onEnd?.({
        callId: 'c1',
        content: [
          {
            type: 'tool-approval-request',
            approvalId: 'a1',
            toolCall: { toolName: 'deleteArticle' },
            reason: 'destructive',
          },
        ],
      } as any);
    });

    expect(callsOf(profile)[0]?.approvals).toEqual([
      { approvalId: 'a1', tool: 'deleteArticle', decision: 'requested', reason: 'destructive' },
    ]);
  });

  it('synthesizes a call for an operation that emits no model-call events', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onStart?.({
        callId: 'obj',
        operationId: 'ai.generateObject',
        provider: 'openai',
        modelId: 'gpt-test',
        output: 'object',
        schema: { type: 'object' },
        schemaName: 'Digest',
        prompt: 'Digest this',
      } as any);
      telemetry.onEnd?.({
        callId: 'obj',
        object: { ok: true },
        finishReason: 'stop',
        usage: USAGE,
        warnings: [{ message: 'unsupported setting' }],
      } as any);
    });

    const [call] = callsOf(profile);
    expect(call).toMatchObject({
      operation: 'ai.generateObject',
      outputStrategy: 'object',
      schemaName: 'Digest',
      output: { ok: true },
      warnings: ['unsupported setting'],
    });
    expect(call?.usage?.total).toBe(17);
  });

  it('reads the provider cost and the stop sequences', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onLanguageModelCallStart?.({
        callId: 'c3',
        provider: 'openrouter',
        modelId: 'm',
        messages: [],
        stopSequences: ['END', 42],
        seed: 7,
        topP: 0.9,
      } as any);
      telemetry.onLanguageModelCallEnd?.({
        callId: 'c3',
        provider: 'openrouter',
        modelId: 'm',
        finishReason: 'stop',
        usage: USAGE,
        content: [],
        responseId: 'r',
        providerMetadata: { openrouter: { usage: { cost: 0.0042 } } },
        performance: PERFORMANCE,
      } as any);
    });

    const [call] = callsOf(profile);
    expect(call?.cost).toBe(0.0042);
    expect(call?.settings).toMatchObject({ stopSequences: ['END'], seed: 7, topP: 0.9 });
  });

  it('reports no cost when the provider metadata carries none', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      start('c4');
      telemetry.onLanguageModelCallEnd?.({
        callId: 'c4',
        provider: 'openai',
        modelId: 'gpt-test',
        finishReason: 'stop',
        usage: USAGE,
        content: [],
        responseId: '',
        providerMetadata: { openai: {} },
        performance: PERFORMANCE,
      } as any);
    });

    expect(callsOf(profile)[0]?.cost).toBeUndefined();
  });

  it('describes a warning whatever shape the provider gave it', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      start('c5');
      end('c5');
      telemetry.onEnd?.({
        callId: 'c5',
        warnings: ['plain string', { message: 'structured' }, { odd: true }],
      } as any);
    });

    expect(callsOf(profile)[0]?.warnings).toEqual(['plain string', 'structured', '{"odd":true}']);
  });

  it('carries the operation tool choice onto the call settings', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onStart?.({
        callId: 'c6',
        operationId: 'ai.generateText',
        toolChoice: { type: 'tool', toolName: 'shout' },
      } as any);
      telemetry.onLanguageModelCallStart?.({
        callId: 'c6',
        provider: 'p',
        modelId: 'm',
        messages: [],
        temperature: 0.1,
      } as any);
      end('c6');
    });

    expect(callsOf(profile)[0]?.settings?.toolChoice).toBe('tool:shout');
  });

  it('accepts a plain tool choice', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onStart?.({
        callId: 'c7',
        operationId: 'ai.generateText',
        toolChoice: 'required',
      } as any);
      telemetry.onLanguageModelCallStart?.({
        callId: 'c7',
        provider: 'p',
        modelId: 'm',
        messages: [],
      } as any);
      end('c7');
    });

    expect(callsOf(profile)[0]?.settings?.toolChoice).toBe('required');
  });

  it('ignores an operation end for a call it never saw', async () => {
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onEnd?.({ callId: 'never', object: { ok: true } } as any);
    });

    expect(entriesOf(profile)).toEqual([]);
  });

  it('records nothing outside a profiled execution', () => {
    expect(() => {
      start();
      end();
    }).not.toThrow();
  });

  describe('cost', () => {
    afterEach(() => resetAiPricing());

    it('prices a call from the configured table when the provider reports none', async () => {
      configureAiPricing({ table: { 'openai:gpt-test': { input: 1, output: 2, cacheRead: 0.5 } } });
      const profile = newProfile();
      await withProfile(profile, () => {
        start();
        end();
      });

      const [call] = callsOf(profile);
      // 12 input = 10 fresh + 2 cache reads; 5 output, thinking billed at the output rate.
      expect(call?.cost).toBeCloseTo((10 * 1 + 2 * 0.5 + 5 * 2) / 1_000_000, 9);
      expect(call?.costSource).toBe('estimated');
    });

    it('keeps the provider figure over the configured prices', async () => {
      configureAiPricing({ table: { 'gpt-test': { input: 1000, output: 1000 } } });
      const profile = newProfile();
      await withProfile(profile, () => {
        telemetry.onLanguageModelCallEnd?.({
          callId: 'c9',
          provider: 'openrouter',
          modelId: 'gpt-test',
          finishReason: 'stop',
          usage: USAGE,
          content: [],
          responseId: 'r',
          providerMetadata: { openrouter: { usage: { cost: 0.0042 } } },
          performance: PERFORMANCE,
        } as any);
      });

      const [call] = callsOf(profile);
      expect(call).toMatchObject({ cost: 0.0042, costSource: 'provider' });
    });

    it('prices a resolved snapshot under the model the call asked for', async () => {
      configureAiPricing({ table: { 'openai:gpt-test': { input: 1, output: 2, cacheRead: 0.5 } } });
      const profile = newProfile();
      await withProfile(profile, () => {
        start();
        // The provider answers as the dated snapshot it resolved `gpt-test` to, which nobody priced.
        telemetry.onLanguageModelCallEnd?.({
          callId: 'c1',
          provider: 'openai.responses',
          modelId: 'gpt-test-2024-07-18',
          finishReason: 'stop',
          usage: USAGE,
          content: [],
          responseId: 'r',
          performance: PERFORMANCE,
        } as any);
      });

      const [call] = callsOf(profile);
      expect(call?.model).toBe('gpt-test-2024-07-18');
      expect(call?.cost).toBeCloseTo((10 * 1 + 2 * 0.5 + 5 * 2) / 1_000_000, 9);
      expect(call?.costSource).toBe('estimated');
    });

    it('keeps a price set on the resolved model over the one asked for', async () => {
      configureAiPricing({
        table: {
          'openai:gpt-test': { input: 1, output: 2 },
          'openai:gpt-test-2024-07-18': { input: 10, output: 20 },
        },
      });
      const profile = newProfile();
      await withProfile(profile, () => {
        start();
        telemetry.onLanguageModelCallEnd?.({
          callId: 'c1',
          provider: 'openai.responses',
          modelId: 'gpt-test-2024-07-18',
          finishReason: 'stop',
          usage: USAGE,
          content: [],
          responseId: 'r',
          performance: PERFORMANCE,
        } as any);
      });

      const [call] = callsOf(profile);
      expect(call?.cost).toBeCloseTo((12 * 10 + 5 * 20) / 1_000_000, 9);
    });

    it('leaves the cost off entirely when no price is known', async () => {
      const profile = newProfile();
      await withProfile(profile, () => {
        start();
        end();
      });

      const [call] = callsOf(profile);
      expect(call?.cost).toBeUndefined();
      expect(call?.costSource).toBeUndefined();
    });
  });
});
