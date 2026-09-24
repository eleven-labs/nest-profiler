import { ClsServiceManager } from 'nestjs-cls';
import {
  HTTP_ENTRYPOINT_TYPE,
  appendCollectorEntry,
  getCollectorEntries,
  setProfileContext,
} from '@eleven-labs/nest-profiler';
import type { Profile, TaggableEntry } from '@eleven-labs/nest-profiler';
import { AiProfilerTelemetry } from './ai-telemetry';
import { AiCollector } from './ai.collector';
import { configureAiCapture, resetAiCapture } from './ai-capture';
import { AI_ENTRIES_KEY } from './ai-call.interface';
import type { AiCallEntry, AiEntry } from './ai-call.interface';

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

async function withProfile(profile: Profile, work: () => Promise<void>): Promise<void> {
  const cls = ClsServiceManager.getClsService();
  await cls.run(async () => {
    setProfileContext(cls, profile);
    await work();
  });
}

const callsOf = (profile: Profile): AiCallEntry[] =>
  getCollectorEntries<AiEntry>(profile, AI_ENTRIES_KEY).filter(
    (e): e is AiCallEntry => e.kind === 'call',
  );

const REQUEST_BODY = {
  model: 'gpt-test',
  max_tokens: 256,
  messages: [{ role: 'user', content: 'My key is sk-abcdefghijklmnopqrstuvwxyz' }],
};
const RESPONSE_BODY = {
  id: 'chatcmpl-1',
  choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
  access_token: 'leaked',
};
const RESPONSE_HEADERS = { 'x-request-id': 'req-1', 'set-cookie': '__cf_bm=abc' };

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
describe('AiProfilerTelemetry — provider payload', () => {
  let telemetry: AiProfilerTelemetry;

  beforeEach(() => {
    telemetry = new AiProfilerTelemetry();
    resetAiCapture();
  });

  const startCall = (): void => {
    telemetry.onStart?.({
      callId: 'c1',
      operationId: 'ai.generateText',
      provider: 'openai',
      modelId: 'gpt-test',
    } as any);
    telemetry.onLanguageModelCallStart?.({
      callId: 'c1',
      provider: 'openai',
      modelId: 'gpt-test',
      messages: [{ role: 'user', content: 'Hello' }],
    } as any);
  };

  const endCall = (): void => {
    telemetry.onLanguageModelCallEnd?.({
      callId: 'c1',
      provider: 'openai',
      modelId: 'gpt-test',
      finishReason: 'stop',
      usage: {
        inputTokens: 12,
        inputTokenDetails: {},
        outputTokens: 5,
        outputTokenDetails: {},
        totalTokens: 17,
      },
      content: [{ type: 'text', text: 'Hi' }],
      responseId: 'chatcmpl-1',
      performance: { responseTimeMs: 10 },
    } as any);
  };

  const execute = <T>(run: () => Promise<T>): PromiseLike<T> | undefined =>
    telemetry.executeLanguageModelCall?.({ callId: 'c1', execute: run });

  const generateResult = {
    content: [],
    request: { body: REQUEST_BODY },
    response: { headers: RESPONSE_HEADERS, body: RESPONSE_BODY },
  };

  it('records nothing of the payload unless it is asked for by name', async () => {
    configureAiCapture({ capture: 'full' });
    const profile = newProfile();
    await withProfile(profile, async () => {
      startCall();
      await execute(() => Promise.resolve(generateResult));
      endCall();
    });

    expect(callsOf(profile)[0]?.payload).toBeUndefined();
  });

  it('records the raw request and response of a generated call, masked', async () => {
    configureAiCapture({ capture: { providerPayload: 'redacted' } });
    const profile = newProfile();
    await withProfile(profile, async () => {
      startCall();
      await execute(() => Promise.resolve(generateResult));
      endCall();
    });

    const payload = callsOf(profile)[0]?.payload;
    const request = payload?.requestBody as typeof REQUEST_BODY;
    const response = payload?.responseBody as typeof RESPONSE_BODY;
    // Token counts are numbers, not credentials, and survive the key-name masking.
    expect(request.max_tokens).toBe(256);
    expect(response.usage).toEqual(RESPONSE_BODY.usage);
    expect(request.messages[0]?.content).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(response.access_token).toBe('[REDACTED]');
    expect(payload?.responseHeaders).toEqual({
      'x-request-id': 'req-1',
      'set-cookie': '[REDACTED]',
    });
    expect(payload?.streamed).toBeUndefined();
  });

  it('keeps the payload verbatim at full', async () => {
    configureAiCapture({ capture: { providerPayload: 'full' } });
    const profile = newProfile();
    await withProfile(profile, async () => {
      startCall();
      await execute(() => Promise.resolve(generateResult));
      endCall();
    });

    const payload = callsOf(profile)[0]?.payload;
    expect(payload?.requestBody).toEqual(REQUEST_BODY);
    expect(payload?.responseBody).toEqual(RESPONSE_BODY);
    expect(payload?.responseHeaders?.['set-cookie']).toBe('__cf_bm=abc');
  });

  it('marks a streamed call, whose body is not there to record', async () => {
    configureAiCapture({ capture: { providerPayload: 'full' } });
    const profile = newProfile();
    await withProfile(profile, async () => {
      startCall();
      await execute(() =>
        Promise.resolve({
          stream: new ReadableStream(),
          request: { body: REQUEST_BODY },
          response: { headers: RESPONSE_HEADERS },
        }),
      );
      endCall();
    });

    const payload = callsOf(profile)[0]?.payload;
    expect(payload?.streamed).toBe(true);
    expect(payload?.requestBody).toEqual(REQUEST_BODY);
    expect(payload).not.toHaveProperty('responseBody');
  });

  it('parses a body the provider sent as a JSON string, and bounds a large one', async () => {
    configureAiCapture({ capture: { providerPayload: 'full' }, maxTextLength: 10 });
    const profile = newProfile();
    await withProfile(profile, async () => {
      startCall();
      await execute(() =>
        Promise.resolve({
          request: { body: JSON.stringify({ image: 'x'.repeat(100) }) },
          response: {},
        }),
      );
      endCall();
    });

    expect(callsOf(profile)[0]?.payload?.requestBody).toEqual({ image: `${'x'.repeat(10)}…` });
  });

  it('records the whole round-trip of a call the provider refused', async () => {
    configureAiCapture({ capture: { providerPayload: 'full' } });
    const profile = newProfile();
    const refusal = Object.assign(new Error('Bad Request'), {
      url: 'https://api.openai.com/v1/chat/completions',
      statusCode: 400,
      requestBodyValues: REQUEST_BODY,
      responseHeaders: { 'x-request-id': 'req-2' },
      responseBody: '{"error":{"message":"Unsupported parameter"}}',
    });
    await withProfile(profile, async () => {
      startCall();
      await expect(execute(() => Promise.reject(refusal))).rejects.toBe(refusal);
      telemetry.onError?.({ callId: 'c1', error: refusal });
    });

    const [call] = callsOf(profile);
    expect(call?.error).toBe('Bad Request');
    expect(call?.payload).toEqual({
      url: 'https://api.openai.com/v1/chat/completions',
      statusCode: 400,
      requestBody: REQUEST_BODY,
      responseHeaders: { 'x-request-id': 'req-2' },
      responseBody: { error: { message: 'Unsupported parameter' } },
    });
  });

  it('records the payload of a generateObject call from its step-end event', async () => {
    configureAiCapture({ capture: { providerPayload: 'full' } });
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onStart?.({
        callId: 'o1',
        operationId: 'ai.generateObject',
        provider: 'openai',
        modelId: 'gpt-test',
      } as any);
      telemetry.onObjectStepEnd?.({
        callId: 'o1',
        request: { body: REQUEST_BODY },
        response: { headers: RESPONSE_HEADERS, body: RESPONSE_BODY },
      } as any);
      telemetry.onEnd?.({ callId: 'o1', object: { ok: true } } as any);
      return Promise.resolve();
    });

    expect(callsOf(profile)[0]?.payload).toEqual({
      requestBody: REQUEST_BODY,
      responseHeaders: RESPONSE_HEADERS,
      responseBody: RESPONSE_BODY,
    });
  });

  it('marks a streamObject call as streamed', async () => {
    configureAiCapture({ capture: { providerPayload: 'full' } });
    const profile = newProfile();
    await withProfile(profile, () => {
      telemetry.onStart?.({ callId: 'o2', operationId: 'ai.streamObject' } as any);
      telemetry.onObjectStepEnd?.({
        callId: 'o2',
        request: { body: REQUEST_BODY },
        response: { headers: RESPONSE_HEADERS },
      } as any);
      telemetry.onEnd?.({ callId: 'o2' } as any);
      return Promise.resolve();
    });

    expect(callsOf(profile)[0]?.payload).toEqual({
      requestBody: REQUEST_BODY,
      responseHeaders: RESPONSE_HEADERS,
      streamed: true,
    });
  });

  it('reads a refusal off the error when the call ran unwrapped', async () => {
    configureAiCapture({ capture: { providerPayload: 'full' } });
    const profile = newProfile();
    const refusal = Object.assign(new Error('Bad Request'), {
      url: 'https://api.openai.com/v1/chat/completions',
      statusCode: 400,
    });
    await withProfile(profile, () => {
      telemetry.onStart?.({ callId: 'o3', operationId: 'ai.generateObject' } as any);
      telemetry.onError?.({ callId: 'o3', error: refusal });
      return Promise.resolve();
    });

    expect(callsOf(profile)[0]?.payload).toEqual({
      url: 'https://api.openai.com/v1/chat/completions',
      statusCode: 400,
    });
  });

  it("records a structured generateText's schema and parsed object", async () => {
    const profile = newProfile();
    await withProfile(profile, async () => {
      telemetry.onStart?.({
        callId: 'c1',
        operationId: 'ai.generateText',
        provider: 'openai',
        modelId: 'gpt-test',
        output: {
          name: 'object',
          responseFormat: Promise.resolve({
            type: 'json',
            schema: { type: 'object', required: ['title'] },
            name: 'Digest',
          }),
        },
      } as any);
      await Promise.resolve();
      telemetry.onLanguageModelCallStart?.({ callId: 'c1', messages: [] } as any);
      endCall();
      telemetry.onEnd?.({ callId: 'c1', text: '{"title":"Hi"}' } as any);
    });

    expect(callsOf(profile)[0]).toMatchObject({
      outputStrategy: 'object',
      schemaName: 'Digest',
      outputSchema: { type: 'object', required: ['title'] },
      output: { title: 'Hi' },
    });
  });

  it('nests an HTTP call made by the provider under the model call in the trace', async () => {
    const profile = newProfile();
    await withProfile(profile, async () => {
      startCall();
      await execute(() => {
        // What `nest-profiler-http`'s fetch adapter does from inside the provider's request.
        appendCollectorEntry<TaggableEntry>(profile, 'http', {
          startedAt: Date.now(),
          duration: 1,
        });
        return Promise.resolve(generateResult);
      });
      endCall();
    });

    const [call] = callsOf(profile);
    const [http] = getCollectorEntries<TaggableEntry>(profile, 'http');
    expect(call?.spanId).toBeDefined();
    expect(http?.parentSpanId).toBe(call?.spanId);
    // The model call itself stays where it was issued, not under its own span.
    expect(call?.parentSpanId).toBeUndefined();

    const collector = new AiCollector();
    profile.collectors['ai'] = collector.collect(profile);
    expect(collector.getTraceSpans(profile)[0]?.id).toBe(call?.spanId);
  });

  it('runs the provider request unchanged outside a profile', async () => {
    await expect(execute(() => Promise.resolve('answer'))).resolves.toBe('answer');
  });
});
