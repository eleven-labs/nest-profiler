import { ClsServiceManager } from 'nestjs-cls';
import {
  HTTP_ENTRYPOINT_TYPE,
  getCollectorEntries,
  setProfileContext,
} from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import type { Telemetry } from 'ai';
import { currentAiAgent } from '../ai-agent';
import { HARNESS_OPERATION, harnessFrameworkOf } from '../ai-harness-operation';
import {
  HarnessInstrumentation,
  harnessTelemetryFor,
  instrumentHarnessAgentClass,
} from './harness.instrumentation';
import { AiProfilerTelemetry } from '../ai-telemetry';
import { resetAiCapture } from '../ai-capture';
import { configureAiPricing, resetAiPricing } from '../ai-pricing';
import { AI_ENTRIES_KEY } from '../ai-call.interface';
import type { AiCallEntry, AiEntry, AiToolExecutionEntry } from '../ai-call.interface';

const integration: Telemetry = {};
const other: Telemetry = {};

describe('harnessFrameworkOf', () => {
  it('names the harness a turn ran under, from the provider it reports', () => {
    expect(
      harnessFrameworkOf({ operationId: HARNESS_OPERATION, provider: 'harness:claude-code' }),
    ).toBe('harness:claude-code');
  });

  it('falls back to a bare `harness` when the provider is missing', () => {
    expect(harnessFrameworkOf({ operationId: HARNESS_OPERATION })).toBe('harness');
  });

  it('says nothing about any other operation', () => {
    expect(harnessFrameworkOf({ operationId: 'ai.generateText', provider: 'openai' })).toBe(
      undefined,
    );
  });
});

describe('harnessTelemetryFor', () => {
  it('hands the profiler integration, and only it, to an agent without telemetry', () => {
    expect(harnessTelemetryFor(undefined, integration)).toEqual({ integrations: [integration] });
  });

  it('leaves an agent that switched telemetry off alone', () => {
    expect(harnessTelemetryFor({ isEnabled: false }, integration)).toBeUndefined();
  });

  it('leaves an agent reporting to the global integrations alone', () => {
    expect(harnessTelemetryFor({ functionId: 'x' }, integration)).toBeUndefined();
  });

  it('adds the profiler integration to the agent’s own', () => {
    expect(harnessTelemetryFor({ functionId: 'x', integrations: other }, integration)).toEqual({
      functionId: 'x',
      integrations: [other, integration],
    });
    expect(harnessTelemetryFor({ integrations: [other] }, integration)).toEqual({
      integrations: [other, integration],
    });
  });

  it('does not add it twice', () => {
    expect(harnessTelemetryFor({ integrations: [integration] }, integration)).toBeUndefined();
  });
});

describe('instrumentHarnessAgentClass', () => {
  /** A stand-in for `HarnessAgent`: the settings it reads at call time and the four turn methods. */
  class FakeHarnessAgent {
    seen: Array<{ agent: ReturnType<typeof currentAiAgent>; telemetry: unknown }> = [];

    constructor(
      public settings: { telemetry?: unknown; [key: string]: unknown },
      readonly id?: string,
    ) {}

    private async turn(): Promise<string> {
      await Promise.resolve();
      this.seen.push({ agent: currentAiAgent(), telemetry: this.settings?.telemetry });
      return 'done';
    }

    generate(): Promise<string> {
      return this.turn();
    }

    stream(): Promise<string> {
      return this.turn();
    }

    continueGenerate(): Promise<string> {
      return this.turn();
    }

    continueStream(): Promise<string> {
      return this.turn();
    }
  }

  beforeAll(() => {
    expect(instrumentHarnessAgentClass(FakeHarnessAgent, integration)).toBe(true);
  });

  it('instruments a class once', () => {
    expect(instrumentHarnessAgentClass(FakeHarnessAgent, integration)).toBe(false);
  });

  it('refuses what is not a class', () => {
    expect(instrumentHarnessAgentClass(undefined, integration)).toBe(false);
    expect(instrumentHarnessAgentClass({}, integration)).toBe(false);
  });

  it('names the agent and routes its telemetry on every turn method', async () => {
    const agent = new FakeHarnessAgent({ model: 'm' }, 'coding-agent');

    await agent.generate();
    await agent.stream();
    await agent.continueGenerate();
    await agent.continueStream();

    expect(agent.seen).toHaveLength(4);
    for (const seen of agent.seen) {
      expect(seen.agent).toEqual({ id: 'coding-agent', name: 'coding-agent' });
      expect(seen.telemetry).toEqual({ integrations: [integration] });
    }
  });

  it('completes a copy of the settings, never the object the application passed in', async () => {
    const settings = { model: 'm' };
    const agent = new FakeHarnessAgent(settings);

    await agent.generate();

    expect(settings).toEqual({ model: 'm' });
    expect(agent.settings).toEqual({ model: 'm', telemetry: { integrations: [integration] } });
  });

  it('opens no frame for an agent without an id', async () => {
    const agent = new FakeHarnessAgent({});

    await agent.generate();

    expect(agent.seen[0]?.agent).toBeUndefined();
  });

  it('keeps settings it cannot read as they are', async () => {
    const agent = new FakeHarnessAgent({});
    (agent as { settings: unknown }).settings = undefined;

    await expect(agent.generate()).resolves.toBe('done');
  });
});

/** A bare profile, as the HTTP middleware would have opened it. */
function newProfile(): Profile {
  return {
    token: 't',
    traceId: 'tr',
    createdAt: Date.now(),
    entrypoint: { type: HTTP_ENTRYPOINT_TYPE, data: { method: 'POST', url: '/agent' } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

const usageOf = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});
const USAGE = usageOf(30, 7);
/** What Codex reports: nothing per step, the whole turn on `finish`. */
const TURN = usageOf(100, 20);

/**
 * A coding-agent runtime reduced to one scripted turn: it runs its own `Bash` tool, then answers.
 * Enough of the `HarnessV1` contract for the real `HarnessAgent` to drive it end to end.
 */
function scriptedHarness({ stepUsage = USAGE, totalUsage = USAGE } = {}): unknown {
  return {
    specificationVersion: 'harness-v1',
    harnessId: 'fake-code',
    builtinTools: {},
    doStart: ({ sessionId }: { sessionId: string }) =>
      Promise.resolve({
        sessionId,
        isResume: false,
        doPromptTurn: ({ emit }: { emit: (part: unknown) => void }) => {
          const done = (async () => {
            await Promise.resolve();
            emit({ type: 'stream-start', modelId: 'fake-model' });
            emit({
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'bash',
              input: JSON.stringify({ command: 'ls' }),
              providerExecuted: true,
            });
            emit({
              type: 'tool-result',
              toolCallId: 'call-1',
              toolName: 'bash',
              result: { stdout: 'README.md' },
            });
            emit({
              type: 'finish-step',
              finishReason: { unified: 'tool-calls' },
              usage: stepUsage,
            });
            emit({ type: 'text-start', id: 't1' });
            emit({ type: 'text-delta', id: 't1', delta: 'There is a README.' });
            emit({ type: 'text-end', id: 't1' });
            emit({ type: 'finish-step', finishReason: { unified: 'stop' }, usage: stepUsage });
            emit({ type: 'finish', finishReason: { unified: 'stop' }, totalUsage });
          })();
          return Promise.resolve({ submitToolResult: () => Promise.resolve(), done });
        },
        doCompact: () => Promise.resolve(),
        doContinueTurn: () => Promise.reject(new Error('not scripted')),
        doSuspendTurn: () => Promise.reject(new Error('not scripted')),
        doDetach: () => Promise.resolve({}),
        doStop: () => Promise.resolve({}),
        doDestroy: () => Promise.resolve(),
      }),
  };
}

/**
 * A sandbox where every command succeeds, printing the one path the agent asks for (its working
 * directory), and every file is empty — the harness above uses none.
 */
function inertSandbox(): unknown {
  return {
    run: () => Promise.resolve({ exitCode: 0, stdout: '/work', stderr: '' }),
    readTextFile: () => Promise.resolve(''),
    writeTextFile: () => Promise.resolve(),
  };
}

/**
 * The real `HarnessAgent` is ESM-only, and Jest loads an ES module from this CommonJS suite only
 * on Node 24.9 and later. Earlier, these run in the example app's e2e suite instead.
 */
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
const loadsEsm = major > 24 || (major === 24 && minor >= 9);

(loadsEsm ? describe : describe.skip)('HarnessAgent end to end', () => {
  beforeAll(async () => {
    // What `AiCollectorModule` does with `instrumentations: [HarnessInstrumentation]`.
    await new HarnessInstrumentation().install(telemetry);
  });

  it('instruments the installed HarnessAgent class', async () => {
    const { HarnessAgent } = await import('@ai-sdk/harness/agent');

    expect(instrumentHarnessAgentClass(HarnessAgent, telemetry)).toBe(false);
  });

  const telemetry = new AiProfilerTelemetry();

  beforeEach(() => resetAiCapture());

  /** Runs one turn of an agent on `harness` inside a profiled request, and returns its calls. */
  async function callsOfTurn(harness: unknown): Promise<AiCallEntry[]> {
    const { HarnessAgent } = await import('@ai-sdk/harness/agent');
    const agent = new HarnessAgent({ id: 'coding-agent', harness: harness as never });
    const profile = newProfile();
    const cls = ClsServiceManager.getClsService();
    await cls.run(async () => {
      setProfileContext(cls, profile);
      const session = await agent.createSession({ sandboxSession: inertSandbox() as never });
      try {
        await agent.generate({ session, prompt: 'What is in this repository?' });
      } finally {
        await session.destroy();
      }
    });
    return getCollectorEntries<AiEntry>(profile, AI_ENTRIES_KEY).filter(
      (e): e is AiCallEntry => e.kind === 'call',
    );
  }

  it('puts the tokens of a turn reported as a whole on its last call, and costs them', async () => {
    configureAiPricing({ table: { 'fake-model': { input: 1, output: 2 } } });
    try {
      const calls = await callsOfTurn(
        scriptedHarness({ stepUsage: usageOf(0, 0), totalUsage: TURN }),
      );

      expect(calls[0]?.usage).toMatchObject({ input: 0, output: 0 });
      expect(calls[1]?.usage).toMatchObject({ input: 100, output: 20, total: 120 });
      expect(calls[1]?.cost).toBeCloseTo((100 * 1 + 20 * 2) / 1_000_000, 9);
    } finally {
      resetAiPricing();
    }
  });

  it('leaves alone the tokens each step reported', async () => {
    const calls = await callsOfTurn(scriptedHarness({ stepUsage: USAGE, totalUsage: TURN }));

    expect(calls.map((call) => call.usage)).toEqual([
      expect.objectContaining({ input: 30, output: 7 }),
      expect.objectContaining({ input: 30, output: 7 }),
    ]);
  });

  it('records the turn’s model calls and the runtime’s own tools, attributed to the agent', async () => {
    const { HarnessAgent } = await import('@ai-sdk/harness/agent');
    const agent = new HarnessAgent({
      id: 'coding-agent',
      harness: scriptedHarness() as never,
    });
    const profile = newProfile();

    const cls = ClsServiceManager.getClsService();
    const text = await cls.run(async () => {
      setProfileContext(cls, profile);
      const session = await agent.createSession({ sandboxSession: inertSandbox() as never });
      try {
        const result = await agent.generate({ session, prompt: 'What is in this repository?' });
        return result.text;
      } finally {
        await session.destroy();
      }
    });

    expect(text).toBe('There is a README.');
    const entries = getCollectorEntries<AiEntry>(profile, AI_ENTRIES_KEY);
    const calls = entries.filter((e): e is AiCallEntry => e.kind === 'call');
    const tools = entries.filter((e): e is AiToolExecutionEntry => e.kind === 'tool');
    const agentInfo = { id: 'coding-agent', name: 'coding-agent', framework: 'harness:fake-code' };

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      operation: HARNESS_OPERATION,
      provider: 'harness:fake-code',
      model: 'fake-model',
      step: 0,
      agent: agentInfo,
      usage: { input: 30, output: 7 },
      toolCalls: [{ name: 'bash', origin: 'harness' }],
    });
    expect(calls[1]).toMatchObject({ step: 1, completion: 'There is a README.' });
    expect(tools).toEqual([
      expect.objectContaining({ name: 'bash', origin: 'harness', agent: agentInfo }),
    ]);
  });
});
