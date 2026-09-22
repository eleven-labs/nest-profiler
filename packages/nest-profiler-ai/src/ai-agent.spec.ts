import { agentFrameworkOf, currentAiAgent, instrumentAgentClass, profileAgent } from './ai-agent';
import type { AiAgentLike } from './ai-agent';

/** A stand-in for `ToolLoopAgent`: the two methods the SDK calls, plus the state around them. */
class FakeAgent implements AiAgentLike {
  readonly version = 'agent-v1';
  seen: Array<ReturnType<typeof currentAiAgent>> = [];

  constructor(readonly id: string | undefined) {}

  get tools(): Record<string, unknown> {
    // Reads through `this` on purpose: a getter must keep working behind the proxy.
    return { probe: this.id };
  }

  /** Lets a test run another agent from inside this one, the way a tool would. */
  before?: () => Promise<unknown>;

  async generate(options: never): Promise<unknown> {
    await this.before?.();
    this.seen.push(currentAiAgent());
    return { called: 'generate', options };
  }

  async stream(options: never): Promise<unknown> {
    // The frame has to survive the awaits `agent.stream` makes before it reaches the model.
    await Promise.resolve();
    this.seen.push(currentAiAgent());
    return { called: 'stream', options };
  }
}

describe('agentFrameworkOf', () => {
  it('reads the marker the SDK appends to the outgoing user-agent', () => {
    const headers = { 'user-agent': 'ai/7.0.0 ai-sdk-agent/tool-loop' };

    expect(agentFrameworkOf(headers)).toBe('tool-loop');
  });

  it('accepts the header under its canonical casing', () => {
    expect(agentFrameworkOf({ 'User-Agent': 'ai-sdk-agent/tool-loop' })).toBe('tool-loop');
  });

  it.each([
    ['no headers at all', undefined],
    ['headers without a user-agent', {}],
    ['a user-agent that is not a string', { 'user-agent': 7 }],
    ['a plain SDK call', { 'user-agent': 'ai/7.0.0 ai-sdk/openai/2.0.0' }],
    // Anchored on a word boundary, so a provider name ending in the marker is not one.
    ['a lookalike suffix', { 'user-agent': 'not-ai-sdk-agent/tool-loop' }],
  ])('returns undefined for %s', (_case, headers) => {
    expect(agentFrameworkOf(headers)).toBeUndefined();
  });
});

describe('profileAgent', () => {
  it('names the agent for the duration of generate', async () => {
    const agent = new FakeAgent('support');

    await profileAgent(agent).generate(undefined as never);

    expect(agent.seen).toEqual([{ id: 'support', name: 'support' }]);
  });

  it('keeps the frame across the awaits stream makes', async () => {
    const agent = new FakeAgent('support');

    await profileAgent(agent, { name: 'Support' }).stream(undefined as never);

    expect(agent.seen).toEqual([{ id: 'support', name: 'Support' }]);
  });

  it('names an agent that declares no id of its own', async () => {
    const agent = new FakeAgent(undefined);

    await profileAgent(agent, { id: 'triage' }).generate(undefined as never);

    expect(agent.seen).toEqual([{ id: 'triage', name: 'triage' }]);
  });

  it('records nothing when neither the agent nor the caller names it', async () => {
    const agent = new FakeAgent(undefined);

    await profileAgent(agent).generate(undefined as never);

    expect(agent.seen).toEqual([{}]);
  });

  it('closes the frame once the call is over', async () => {
    await profileAgent(new FakeAgent('support')).generate(undefined as never);

    expect(currentAiAgent()).toBeUndefined();
  });

  it('nests, so an agent calling another is attributed to the inner one', async () => {
    const inner = new FakeAgent('summarizer');
    const outer = {
      id: 'support',
      seen: [] as Array<ReturnType<typeof currentAiAgent>>,
      async generate(): Promise<unknown> {
        await profileAgent(inner).generate(undefined as never);
        this.seen.push(currentAiAgent());
        return undefined;
      },
      stream: (): PromiseLike<unknown> => Promise.resolve(undefined),
    };

    await profileAgent(outer).generate();

    expect(inner.seen).toEqual([{ id: 'summarizer', name: 'summarizer' }]);
    expect(outer.seen).toEqual([{ id: 'support', name: 'support' }]);
  });

  it('passes the call through untouched and returns what the agent returned', async () => {
    const result = await profileAgent(new FakeAgent('support')).generate({ prompt: 'hi' } as never);

    expect(result).toEqual({ called: 'generate', options: { prompt: 'hi' } });
  });

  it('leaves every other member reachable, so it can be handed to the SDK as-is', () => {
    const profiled = profileAgent(new FakeAgent('support'));

    expect(profiled.id).toBe('support');
    expect(profiled.version).toBe('agent-v1');
    expect(profiled.tools).toEqual({ probe: 'support' });
  });
});

describe('instrumentAgentClass', () => {
  /**
   * A fresh stand-in for `ToolLoopAgent` per test: the patch is permanent by design, so a shared
   * class would leak from one test to the next.
   */
  const agentClass = (): typeof FakeAgent => class extends FakeAgent {};

  it('names an agent from the id the SDK already asks for, with no call-site change', async () => {
    const Agent = agentClass();
    instrumentAgentClass(Agent);
    const agent = new Agent('support');

    await agent.generate(undefined as never);

    expect(agent.seen).toEqual([{ id: 'support', name: 'support' }]);
  });

  it('covers agents built before it ran', async () => {
    const Agent = agentClass();
    const agent = new Agent('support');
    instrumentAgentClass(Agent);

    await agent.stream(undefined as never);

    expect(agent.seen).toEqual([{ id: 'support', name: 'support' }]);
  });

  it('leaves an agent that declares no id to the SDK’s own user-agent marker', async () => {
    const Agent = agentClass();
    instrumentAgentClass(Agent);
    const agent = new Agent(undefined);

    await agent.generate(undefined as never);

    expect(agent.seen).toEqual([undefined]);
  });

  it('does not stack when applied twice', async () => {
    const Agent = agentClass();

    expect(instrumentAgentClass(Agent)).toBe(true);
    expect(instrumentAgentClass(Agent)).toBe(false);

    const agent = new Agent('support');
    await agent.generate(undefined as never);
    expect(agent.seen).toEqual([{ id: 'support', name: 'support' }]);
  });

  it('stands down when profileAgent already named the same agent', async () => {
    const Agent = agentClass();
    instrumentAgentClass(Agent);
    const agent = new Agent('support');

    await profileAgent(agent, { name: 'Support agent' }).generate(undefined as never);

    // The wrapper's name wins: the class only knows the id.
    expect(agent.seen).toEqual([{ id: 'support', name: 'Support agent' }]);
  });

  it('still attributes an agent called from inside another agent to the inner one', async () => {
    const Agent = agentClass();
    instrumentAgentClass(Agent);
    const inner = new Agent('summarizer');
    const outer = new Agent('support');
    outer.before = (): Promise<unknown> => inner.generate(undefined as never);

    await outer.generate(undefined as never);

    expect(inner.seen).toEqual([{ id: 'summarizer', name: 'summarizer' }]);
    expect(outer.seen).toEqual([{ id: 'support', name: 'support' }]);
  });

  it('passes the call through and returns what the agent returned', async () => {
    const Agent = agentClass();
    instrumentAgentClass(Agent);

    const result = await new Agent('support').generate({ prompt: 'hi' } as never);

    expect(result).toEqual({ called: 'generate', options: { prompt: 'hi' } });
  });

  it.each([
    ['an `ai` version that exposes no such class', undefined],
    ['something that is not a class', {}],
    ['a function with no prototype', () => undefined],
    ['a class without the two methods', class {}],
  ])('reports doing nothing for %s', (_case, candidate) => {
    expect(instrumentAgentClass(candidate)).toBe(false);
  });
});
