import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ToolLoopAgent,
  generateObject,
  generateText,
  isStepCount,
  jsonSchema,
  streamText,
} from 'ai';
import type { LanguageModel, ModelMessage, ToolSet, UIMessage } from 'ai';
import { LANGUAGE_MODEL } from '../domain/assistant.js';
import type { ApprovalOutcome, ArticleDigest, AssistantAnswer } from '../domain/assistant.js';
import { ApprovalStore } from './approval.store.js';
import { AssistantTools } from './assistant.tools.js';

const SYSTEM_PROMPT =
  'You are the assistant of a NestJS profiler demo. Answer in at most three short sentences.';

const AGENT_SYSTEM_PROMPT =
  'You are the assistant of a NestJS profiler demo. Use the tools you are given to answer, ' +
  'then reply in at most three short sentences.';

/** How hard the model is asked to think — see `AI_REASONING`. */
type ReasoningEffort =
  'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/** Enough steps for one round of tool calls and the answer that follows it. */
const MAX_AGENT_STEPS = 4;

const APPROVAL_REASON = 'Deleting an article is destructive and needs a human decision.';

/** The shape `POST /ai/object` asks the model to fill, and the profiler shows beside the result. */
const DIGEST_SCHEMA = jsonSchema<ArticleDigest>({
  type: 'object',
  properties: {
    title: { type: 'string', description: 'A short title for the text' },
    summary: { type: 'string', description: 'One or two sentences' },
    topics: { type: 'array', items: { type: 'string' }, description: 'Up to three topics' },
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
  },
  required: ['title', 'summary', 'topics', 'sentiment'],
});

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  /** Built on first use, since its tools may have to be discovered on an MCP server. */
  private supportAgent?: Promise<ToolLoopAgent<never, ToolSet>>;

  constructor(
    @Inject(LANGUAGE_MODEL) private readonly model: LanguageModel,
    private readonly config: ConfigService,
    private readonly tools: AssistantTools,
    private readonly approvals: ApprovalStore,
  ) {}

  /**
   * The AI SDK agent the `/ai/agent/*` endpoints run. Built once and reused, the way a real
   * application holds its agents — a tool loop, its instructions and its stop condition, bound
   * together so a call site only has to hand it a prompt.
   *
   * `id` is the SDK's own setting, and the only thing this file does for the profiler — which is
   * to say nothing: the AI panel names every call, step and tool execution after it, and the AI
   * list gains an `Agent` filter, without this module importing the profiler at all.
   */
  agent(): Promise<ToolLoopAgent<never, ToolSet>> {
    this.supportAgent ??= this.buildAgent();
    return this.supportAgent;
  }

  private async buildAgent(): Promise<ToolLoopAgent<never, ToolSet>> {
    return new ToolLoopAgent<never, ToolSet>({
      id: 'support',
      model: this.model,
      instructions: AGENT_SYSTEM_PROMPT,
      tools: await this.tools.buildAll(),
      stopWhen: isStepCount(MAX_AGENT_STEPS),
      ...this.settings(),
    });
  }

  /**
   * The agent's loop, run to completion. Identical to {@link runAgent} from the model's point of
   * view — what differs is who holds the loop, and that the profile says so.
   */
  async runAgentLoop(prompt: string): Promise<AssistantAnswer> {
    const agent = await this.agent();
    const result = await agent.generate({ prompt });

    return this.toAnswer(result.text, result.finishReason, result.usage);
  }

  /** One user turn, in the shape `createAgentUIStream` and its transports expect. */
  static uiMessages(prompt: string): UIMessage[] {
    return [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text: prompt }] }];
  }

  /** Non-streaming baseline: the whole answer arrives at once, like any other JSON endpoint. */
  async ask(prompt: string): Promise<AssistantAnswer> {
    const result = await generateText({
      model: this.model,
      system: SYSTEM_PROMPT,
      prompt,
      ...this.settings(),
    });

    return this.toAnswer(result.text, result.finishReason, result.usage);
  }

  /**
   * Same question, with tools the model may call. Each round trip is its own model call, and each
   * tool run its own entry, so the AI panel shows the whole loop rather than a single answer.
   */
  async runAgent(prompt: string): Promise<AssistantAnswer> {
    const result = await generateText({
      model: this.model,
      system: AGENT_SYSTEM_PROMPT,
      prompt,
      tools: await this.tools.buildAll(),
      stopWhen: isStepCount(MAX_AGENT_STEPS),
      ...this.settings(),
    });

    return this.toAnswer(result.text, result.finishReason, result.usage);
  }

  /**
   * Structured output: the model fills a JSON Schema instead of writing prose. The AI panel shows
   * the schema it had to satisfy next to the object that came back.
   */
  async digest(text: string): Promise<ArticleDigest> {
    const result = await generateObject({
      model: this.model,
      system: SYSTEM_PROMPT,
      schema: DIGEST_SCHEMA,
      schemaName: 'ArticleDigest',
      schemaDescription: 'A short, structured digest of a piece of text.',
      prompt: text,
      ...this.settings(),
    });

    return result.object;
  }

  /**
   * An attachment: the model is sent a file part beside the question. The profiler records what
   * was attached — media type, size or URL — and never the bytes themselves.
   */
  async describe(
    prompt: string,
    attachment: { url: string; mediaType: string },
  ): Promise<AssistantAnswer> {
    const result = await generateText({
      model: this.model,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'file', mediaType: attachment.mediaType, data: new URL(attachment.url) },
          ],
        },
      ],
      ...this.settings(),
    });

    return this.toAnswer(result.text, result.finishReason, result.usage);
  }

  /**
   * First half of a human-in-the-loop exchange: the model may call a destructive tool, but the SDK
   * stops and hands back an approval request instead of running it.
   */
  async requestApproval(prompt: string): Promise<ApprovalOutcome> {
    const messages: ModelMessage[] = [{ role: 'user', content: prompt }];
    const result = await generateText({
      model: this.model,
      system: AGENT_SYSTEM_PROMPT,
      messages,
      tools: await this.tools.buildAll(),
      toolApproval: {
        [AssistantTools.SENSITIVE_TOOL]: { type: 'user-approval', reason: APPROVAL_REASON },
      },
      stopWhen: isStepCount(MAX_AGENT_STEPS),
      ...this.settings(),
    });

    messages.push(...result.responseMessages);
    for (const part of result.content) {
      if (part.type !== 'tool-approval-request') continue;
      const pending = this.approvals.save({
        approvalId: part.approvalId,
        tool: part.toolCall.toolName,
        input: part.toolCall.input,
        messages,
        ...(part.reason !== undefined && { reason: part.reason }),
      });
      return {
        status: 'awaiting-approval',
        pendingId: pending.id,
        tool: pending.tool,
        input: pending.input,
        ...(pending.reason !== undefined && { reason: pending.reason }),
      };
    }

    return { status: 'answered', ...this.toAnswer(result.text, result.finishReason, result.usage) };
  }

  /**
   * Second half: the decision is appended to the conversation and the model is called again. The
   * profile of *this* request carries the approval response, and the tool run only if it was granted.
   */
  async resolveApproval(
    pendingId: string,
    approved: boolean,
  ): Promise<AssistantAnswer | undefined> {
    const pending = this.approvals.take(pendingId);
    if (!pending) return undefined;

    const result = await generateText({
      model: this.model,
      system: AGENT_SYSTEM_PROMPT,
      messages: [
        ...pending.messages,
        {
          role: 'tool',
          content: [
            {
              type: 'tool-approval-response',
              approvalId: pending.approvalId,
              approved,
              reason: approved ? 'Approved by the operator' : 'Denied by the operator',
            },
          ],
        },
      ],
      tools: await this.tools.buildAll(),
      stopWhen: isStepCount(MAX_AGENT_STEPS),
      ...this.settings(),
    });

    return this.toAnswer(result.text, result.finishReason, result.usage);
  }

  /**
   * Streaming answer. The caller decides how to deliver it (raw chunks or SSE) — both are profiled
   * the same way, because the profiler measures the transport rather than the call site.
   */
  stream(prompt: string): ReturnType<typeof streamText> {
    return streamText({
      model: this.model,
      system: SYSTEM_PROMPT,
      prompt,
      ...this.settings(),
      // streamText suppresses errors so a failing model cannot crash the server; without this
      // they would be invisible.
      onError: ({ error }) => this.logger.error(`streamText failed: ${String(error)}`),
    });
  }

  private toAnswer(
    text: string,
    finishReason: string,
    usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number },
  ): AssistantAnswer {
    return {
      model: this.config.getOrThrow<string>('ai.model'),
      text,
      finishReason,
      usage: {
        ...(usage.inputTokens !== undefined && { inputTokens: usage.inputTokens }),
        ...(usage.outputTokens !== undefined && { outputTokens: usage.outputTokens }),
        ...(usage.totalTokens !== undefined && { totalTokens: usage.totalTokens }),
      },
    };
  }

  private settings(): {
    maxOutputTokens: number;
    temperature: number;
    timeout: number;
    reasoning: ReasoningEffort;
    runtimeContext: { tenant: string; locale: string };
  } {
    return {
      maxOutputTokens: this.config.getOrThrow<number>('ai.maxOutputTokens'),
      temperature: this.config.getOrThrow<number>('ai.temperature'),
      timeout: this.config.getOrThrow<number>('ai.timeoutMs'),
      // Captured in the AI panel as reasoning text and reasoning tokens, when the model exposes them.
      reasoning: this.config.getOrThrow<ReasoningEffort>('ai.reasoning'),
      // What a real application threads through a generation and hands its tools — a tenant, a
      // locale, often a token. The AI panel records it only where `capture.runtimeContext` says
      // to, which is why this demo opts in; see `AI_CAPTURE`.
      runtimeContext: { tenant: 'demo', locale: 'en' },
    };
  }
}
