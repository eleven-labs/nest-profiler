import type { Profile } from '@eleven-labs/nest-profiler';
import { AI_ENTRYPOINT_TYPE, buildAiEntrypointType } from './ai-entrypoint';
import type { AiCollectorData } from './ai-call.interface';

const data: AiCollectorData = {
  entries: [
    {
      kind: 'call',
      callId: 'c1',
      step: 0,
      operation: 'ai.streamText',
      provider: 'openai',
      model: 'gpt-test',
      duration: 100,
      startedAt: Date.now(),
      usage: { total: 42 },
      cost: 0.002,
    },
    {
      kind: 'tool',
      callId: 'c1',
      name: 'shout',
      toolCallId: 'tc1',
      duration: 5,
      startedAt: Date.now(),
      origin: 'mcp',
    },
  ],
  callCount: 1,
  toolCount: 1,
  totalTokens: 42,
  totalCost: 0.002,
  costKnown: false,
  costEstimated: false,
  totalDuration: 100,
  toolDuration: 5,
};

function newProfile(collected = true): Profile {
  return {
    token: 't',
    traceId: 'tr',
    createdAt: Date.now(),
    entrypoint: { type: AI_ENTRYPOINT_TYPE, data: { method: 'POST', url: '/chat' } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: collected ? { ai: data } : {},
  };
}

describe('ai entrypoint type', () => {
  const type = buildAiEntrypointType();

  it('indexes the model, calls, tools, tokens and cost', () => {
    expect(type.indexAttributes?.(newProfile())).toEqual({
      aiModel: 'gpt-test',
      aiCalls: 1,
      aiTools: 1,
      aiTokens: 42,
      aiCost: 0.002,
    });
  });

  it('falls back cleanly for a profile whose panel is empty', () => {
    expect(type.indexAttributes?.(newProfile(false))).toMatchObject({
      aiModel: 'unknown',
      aiCalls: 0,
    });
  });

  it('names the models in the breadcrumb, ahead of the URL', () => {
    expect(type.summary(newProfile())).toEqual({
      badge: 'AI',
      badgeClass: 'badge-tag-info',
      text: 'gpt-test · /chat',
    });
  });

  it('falls back to the URL alone when no model is known', () => {
    expect(type.summary(newProfile(false)).text).toBe('/chat');
  });

  it('keeps the HTTP request and response tabs', () => {
    expect(type.detailTabs.map((tab) => tab.name)).toEqual(['request', 'response']);
  });

  it('offers its own list section and model filter', () => {
    expect(type.listSection.title).toBe('AI');
    expect(type.listSection.templatePath).toMatch(/templates[/\\]ai-section\.ejs$/);
    expect(type.listFilters?.map((f) => f.key)).toEqual(['aiModel']);
  });

  it('parses the model filter and turns it into a criterion', () => {
    const filter = type.listFilters?.[0];

    expect(filter?.parse('gpt-test')).toBe('gpt-test');
    expect(filter?.parse('')).toBeUndefined();
    expect(filter?.parse(undefined)).toBeUndefined();
    expect(filter?.toCriterion('gpt-test')).toEqual({
      field: 'attributes.aiModel',
      op: 'eq',
      value: 'gpt-test',
    });
  });

  it('classifies failures the way the host asked', () => {
    const strict = buildAiEntrypointType({ httpStatus: (status) => status >= 400 });
    const profile = newProfile();
    profile.response = { statusCode: 404, headers: {} };

    expect(strict.isError?.(profile)).toBe(true);
    expect(type.isError?.(profile)).toBe(false);
  });
});
