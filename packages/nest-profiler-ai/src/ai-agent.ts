import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which agent drove a generation, when one did.
 *
 * The AI SDK's `Agent` — `ToolLoopAgent`, and everything built on top of it such as
 * `createAgentUIStream` — runs its loop through `generateText` / `streamText`, so its calls and
 * tool executions are recorded like any other. What they do not say on their own is *who* ran
 * them: an application with a support agent, a triage agent and a summarizer sees three
 * identical-looking loops. This is what tells them apart.
 */
export interface AiAgentInfo {
  /** The agent's own `id`, when it declares one. */
  id?: string;
  /** A readable name for the panel and the AI list; defaults to {@link AiAgentInfo.id}. */
  name?: string;
  /**
   * The agent implementation that ran the loop, as the SDK tags its own outgoing requests:
   * `tool-loop` for `ToolLoopAgent`. Absent for a hand-rolled loop.
   */
  framework?: string;
}

/** What {@link profileAgent} needs of an agent — the AI SDK's `Agent`, and anything shaped like it. */
export interface AiAgentLike {
  readonly id?: string | undefined;
  generate(...args: never[]): PromiseLike<unknown>;
  stream(...args: never[]): PromiseLike<unknown>;
}

export interface ProfileAgentOptions {
  /** Recorded instead of the agent's own `id`, for an agent that declares none. */
  id?: string;
  /** Recorded as the agent's name; defaults to its id. */
  name?: string;
}

/**
 * The marker the SDK appends to the outgoing `user-agent` of every request an agent makes —
 * `ai-sdk-agent/tool-loop`. It is what makes an agent run recognisable without the application
 * declaring anything.
 */
const AGENT_MARKER = /(?:^|\s)ai-sdk-agent\/(\S+)/;

/** The two methods an agent exposes, and the two the instrumentation wraps. */
const AGENT_METHODS = ['generate', 'stream'] as const;

/** Marks a prototype as already instrumented, so a second application instance does not stack. */
const INSTRUMENTED = Symbol.for('@eleven-labs/nest-profiler-ai.agent-instrumented');

interface AgentFrame {
  info: AiAgentInfo;
  /**
   * The agent the frame was opened for. Lets the class instrumentation stand down when a
   * `profileAgent` wrapper already opened a frame for the same agent — the wrapper knows a name
   * the class cannot — while an agent calling *another* agent still opens its own.
   */
  target: unknown;
}

/**
 * The agent whose `generate` / `stream` is currently running.
 *
 * An `AsyncLocalStorage` rather than the profiler's CLS: a streamed agent answer keeps producing
 * model calls long after the handler returned, and the frame has to follow the generation rather
 * than the request. One request may also run several agents, nested or in sequence.
 */
const storage = new AsyncLocalStorage<AgentFrame>();

/** The agent frame the calling code is running inside, if any. */
export function currentAiAgent(): AiAgentInfo | undefined {
  return storage.getStore()?.info;
}

/** Reads the agent marker out of the headers the SDK reports on an operation's start event. */
export function agentFrameworkOf(headers: unknown): string | undefined {
  if (typeof headers !== 'object' || headers === null) return undefined;
  const record = headers as Record<string, unknown>;
  // `Object.fromEntries(new Headers(…))` lowercases, but the event is typed loosely enough that
  // a host handing its own headers through is worth reading too.
  const value = record['user-agent'] ?? record['User-Agent'];
  if (typeof value !== 'string') return undefined;
  return AGENT_MARKER.exec(value)?.[1];
}

type AgentMethod = (this: unknown, ...args: unknown[]) => unknown;

/** Runs `call` inside a frame naming `info`, unless one is already open for this same agent. */
function withFrame(info: AiAgentInfo, target: unknown, call: () => unknown): unknown {
  if (storage.getStore()?.target === target) return call();
  return storage.run({ info, target }, call);
}

/**
 * Teaches every AI SDK agent in the process to name itself in the profiles it produces, by
 * wrapping `generate` and `stream` on the agent class's prototype.
 *
 * This is what keeps agent attribution free of any call-site change: the application declares its
 * agent's identity the way the SDK already asks it to, with the `id` setting
 * (`new ToolLoopAgent({ id: 'support', … })`), and never imports the profiler to get it recorded.
 * It is the same bargain as `registerTelemetry` — one registration at startup, nothing anywhere
 * else — and it matters beyond tidiness: an application that keeps the profiler in
 * `devDependencies` cannot import it from a service that production also runs.
 *
 * The wrapper only reads `id` and opens an async frame around the original call; it changes no
 * argument, no result and no error. Agents built before the patch are covered too, since a method
 * is looked up on the prototype at call time.
 *
 * @param agentClass The SDK's `ToolLoopAgent`, resolved at runtime.
 * @returns whether this call instrumented the class — `false` if it was already done, or if the
 *   installed `ai` exposes no such class.
 */
export function instrumentAgentClass(agentClass: unknown): boolean {
  if (typeof agentClass !== 'function') return false;
  const prototype = (agentClass as { prototype?: object }).prototype;
  if (typeof prototype !== 'object' || prototype === null) return false;
  const marked = prototype as Record<PropertyKey, unknown>;
  if (marked[INSTRUMENTED] === true) return false;

  let instrumented = false;
  for (const method of AGENT_METHODS) {
    const original = marked[method];
    if (typeof original !== 'function') continue;
    marked[method] = function (this: { id?: unknown }, ...args: unknown[]): unknown {
      const call = (): unknown => (original as AgentMethod).apply(this, args);
      const id = typeof this.id === 'string' && this.id.length > 0 ? this.id : undefined;
      // An agent that declares no id has nothing to add: the SDK's own user-agent marker already
      // makes the run recognisable as a tool loop.
      return id === undefined ? call() : withFrame({ id, name: id }, this, call);
    };
    instrumented = true;
  }
  if (instrumented) Object.defineProperty(prototype, INSTRUMENTED, { value: true });
  return instrumented;
}

/**
 * Names an agent the class instrumentation cannot name by itself.
 *
 * Reach for it only when {@link instrumentAgentClass} is not enough, which is two cases: an agent
 * that implements the SDK's `Agent` interface itself rather than extending `ToolLoopAgent`, and an
 * agent whose panel name should differ from its `id`. Everything else is already covered — a
 * `ToolLoopAgent` with an `id` is attributed without the application importing anything:
 *
 * ```ts
 * new ToolLoopAgent({ id: 'support', model, tools }); // already named in every profile
 * ```
 *
 * ```ts
 * const support = profileAgent(myCustomAgent, { id: 'support', name: 'Support agent' });
 * await support.generate({ prompt });
 * ```
 *
 * The returned agent is the same object to every caller — same `id`, same `tools`, same results —
 * so it can be provided in place of the original and handed to `createAgentUIStream`,
 * `createAgentUIStreamResponse` or `pipeAgentUIStreamToResponse` unchanged.
 *
 * Note that this puts an import of this package in application code, which rules out keeping the
 * profiler in `devDependencies` for the file that calls it.
 */
export function profileAgent<A extends AiAgentLike>(
  agent: A,
  options: ProfileAgentOptions = {},
): A {
  const id = options.id ?? agent.id;
  const name = options.name ?? id;
  const info: AiAgentInfo = {
    ...(id !== undefined && { id }),
    ...(name !== undefined && { name }),
  };

  return new Proxy(agent, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (!AGENT_METHODS.includes(property as (typeof AGENT_METHODS)[number])) return value;
      if (typeof value !== 'function') return value;
      // The frame goes around the call, not around the returned promise: `stream` resolves long
      // before the model has finished, and every continuation created inside the call — the
      // stream's own pump included — inherits the frame from here. `target` is what the class
      // instrumentation sees as `this`, so it stands down rather than overriding this name.
      return (...args: unknown[]): unknown =>
        storage.run({ info, target }, () => (value as AgentMethod).apply(target, args));
    },
  });
}
