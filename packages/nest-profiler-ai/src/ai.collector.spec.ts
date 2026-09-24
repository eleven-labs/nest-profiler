import { readFileSync } from 'node:fs';
import { appendCollectorEntry } from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import { AiCollector } from './ai.collector';
import { AI_ENTRIES_KEY } from './ai-call.interface';
import { configureAiCapture, resetAiCapture } from './ai-capture';
import type { AiCallEntry, AiCollectorData, AiToolExecutionEntry } from './ai-call.interface';

function newProfile(): Profile {
  return {
    token: 't',
    traceId: 'tr',
    createdAt: Date.now(),
    entrypoint: { type: 'ai', data: { method: 'POST', url: '/chat' } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

const call = (over: Partial<AiCallEntry> = {}): AiCallEntry => ({
  kind: 'call',
  callId: 'c1',
  step: 0,
  operation: 'ai.generateText',
  provider: 'openai',
  model: 'gpt-test',
  duration: 100,
  startedAt: Date.now(),
  usage: { total: 40 },
  cost: 0.002,
  ...over,
});

const tool = (over: Partial<AiToolExecutionEntry> = {}): AiToolExecutionEntry => ({
  kind: 'tool',
  callId: 'c1',
  name: 'shout',
  toolCallId: 'tc1',
  duration: 12,
  startedAt: Date.now(),
  origin: 'mcp',
  ...over,
});

describe('AiCollector', () => {
  let collector: AiCollector;

  beforeEach(() => {
    collector = new AiCollector();
    resetAiCapture();
  });

  afterAll(() => resetAiCapture());

  it('records how the content was captured, so the panel can say what is missing', () => {
    configureAiCapture({ capture: { default: 'redacted', messages: 'none' } });
    const profile = newProfile();
    appendCollectorEntry(profile, AI_ENTRIES_KEY, call());

    expect(collector.collect(profile).capture).toMatchObject({
      messages: 'none',
      completion: 'redacted',
    });
  });

  it('sums the calls, tools, tokens and cost', () => {
    const profile = newProfile();
    appendCollectorEntry(profile, AI_ENTRIES_KEY, call());
    appendCollectorEntry(profile, AI_ENTRIES_KEY, tool());
    appendCollectorEntry(
      profile,
      AI_ENTRIES_KEY,
      call({ step: 1, usage: { total: 2 }, cost: 0.001 }),
    );

    const data = collector.collect(profile);

    expect(data).toMatchObject({
      callCount: 2,
      toolCount: 1,
      totalTokens: 42,
      totalCost: 0.003,
      costKnown: true,
      costEstimated: false,
      totalDuration: 200,
      toolDuration: 12,
    });
    expect(data.entries).toHaveLength(3);
  });

  it('sums costs to the nanodollar, so a fraction of a cent is not rounded away', () => {
    const profile = newProfile();
    appendCollectorEntry(
      profile,
      AI_ENTRIES_KEY,
      call({ cost: 0.000141, costSource: 'estimated' }),
    );
    appendCollectorEntry(profile, AI_ENTRIES_KEY, call({ step: 1, cost: 0.000141 }));

    const data = collector.collect(profile);

    expect(data.totalCost).toBeCloseTo(0.000282, 9);
    expect(data).toMatchObject({ costKnown: true, costEstimated: true });
  });

  it('drains the raw entries so a second collect does not double them', () => {
    const profile = newProfile();
    appendCollectorEntry(profile, AI_ENTRIES_KEY, call());

    profile.collectors[collector.name] = collector.collect(profile);

    expect(profile.collectors[AI_ENTRIES_KEY]).toBeUndefined();
  });

  it('badges the call count, and the tools beside it', () => {
    const profile = newProfile();
    profile.collectors[collector.name] = {
      entries: [],
      callCount: 2,
      toolCount: 1,
      totalTokens: 42,
      totalCost: 0,
      costKnown: false,
      costEstimated: false,
      totalDuration: 0,
      toolDuration: 0,
    } satisfies AiCollectorData;

    expect(collector.getBadgeValue(profile)).toBe('2+1T · 42tok');
  });

  it('has no badge when nothing was called', () => {
    expect(collector.getBadgeValue(newProfile())).toBeNull();
  });

  it('draws one span per call and per tool execution', () => {
    const profile = newProfile();
    profile.collectors[collector.name] = {
      entries: [call(), tool()],
      callCount: 1,
      toolCount: 1,
      totalTokens: 40,
      totalCost: 0,
      costKnown: false,
      costEstimated: false,
      totalDuration: 100,
      toolDuration: 12,
    } satisfies AiCollectorData;

    const spans = collector.getTraceSpans(profile);

    expect(spans.map((s) => s.label)).toEqual(['ai.generateText gpt-test', 'tool shout']);
    expect(spans.every((s) => s.kind === 'ai')).toBe(true);
  });

  it('takes its tag thresholds from the module options', () => {
    const configured = new AiCollector({ slowThreshold: 100, chattyThreshold: 2 });

    expect(configured.getTagConfig()).toMatchObject({
      slowThreshold: 100,
      chattyThreshold: 2,
      nPlusOneThreshold: 3,
    });
    expect(collector.getTagConfig().slowThreshold).toBe(5000);
  });

  it('carries the model, step, tokens and time to first token on a call span', () => {
    const profile = newProfile();
    profile.collectors[collector.name] = {
      entries: [call({ timeToFirstOutput: 120 }), tool()],
      callCount: 1,
      toolCount: 1,
      totalTokens: 40,
      totalCost: 0,
      costKnown: false,
      costEstimated: false,
      totalDuration: 100,
      toolDuration: 12,
    } satisfies AiCollectorData;

    const [callSpan, toolSpan] = collector.getTraceSpans(profile);

    expect(callSpan?.meta).toEqual({ model: 'gpt-test', step: 0, tokens: 40, ttft: '120ms' });
    expect(toolSpan?.meta).toEqual({ tool: 'shout' });
  });

  it('names the agent on every span it produced, so a multi-agent trace can be read', () => {
    const profile = newProfile();
    const agent = { id: 'support', name: 'Support', framework: 'tool-loop' };
    profile.collectors[collector.name] = {
      entries: [call({ agent }), tool({ agent })],
      callCount: 1,
      toolCount: 1,
      totalTokens: 40,
      totalCost: 0,
      costKnown: false,
      costEstimated: false,
      totalDuration: 100,
      toolDuration: 12,
    } satisfies AiCollectorData;

    const [callSpan, toolSpan] = collector.getTraceSpans(profile);

    expect(callSpan?.meta).toMatchObject({ agent: 'Support', model: 'gpt-test' });
    expect(toolSpan?.meta).toMatchObject({ agent: 'Support', tool: 'shout' });
  });

  it('omits the optional call meta when the figures are absent', () => {
    const profile = newProfile();
    profile.collectors[collector.name] = {
      entries: [call({ usage: undefined, timeToFirstOutput: undefined })],
      callCount: 1,
      toolCount: 0,
      totalTokens: 0,
      totalCost: 0,
      costKnown: false,
      costEstimated: false,
      totalDuration: 100,
      toolDuration: 0,
    } satisfies AiCollectorData;

    expect(collector.getTraceSpans(profile)[0]?.meta).toEqual({ model: 'gpt-test', step: 0 });
  });

  it('exposes its entries to the performance-rule engine', () => {
    const profile = newProfile();
    expect(collector.getTaggableEntries(profile)).toEqual([]);
  });

  it('carries the configured tag severities', () => {
    const configured = new AiCollector({
      slowSeverity: 'danger',
      nPlusOneSeverity: 'warning',
      chattySeverity: 'info',
      errorSeverity: 'warning',
    });

    expect(configured.getTagConfig()).toMatchObject({
      slowSeverity: 'danger',
      nPlusOneSeverity: 'warning',
      chattySeverity: 'info',
      errorSeverity: 'warning',
    });
  });

  it('badges the call count alone when no tool ran', () => {
    const profile = newProfile();
    profile.collectors[collector.name] = {
      entries: [],
      callCount: 3,
      toolCount: 0,
      totalTokens: 0,
      totalCost: 0,
      costKnown: false,
      costEstimated: false,
      totalDuration: 0,
      toolDuration: 0,
    } satisfies AiCollectorData;

    expect(collector.getBadgeValue(profile)).toBe('3');
  });

  it('points at the panel template shipped with the package', () => {
    expect(collector.getTemplatePath()).toMatch(/templates[/\\]ai-panel\.ejs$/);
  });

  it('never lets highlight.js guess a language for a code block', () => {
    // A bare `<pre><code>` makes highlight.js auto-detect a language, which colours
    // words like `is` or `in` inside prompts and completions as keywords.
    const template = readFileSync(collector.getTemplatePath(), 'utf8');
    const codeBlocks = template.match(/<pre[^>]*>\s*<code[^>]*>/g) ?? [];

    expect(codeBlocks.length).toBeGreaterThan(0);
    for (const block of codeBlocks) {
      expect(block).toMatch(/<code class="(?:nohighlight|language-[\w-]+)"/);
    }
  });
});
