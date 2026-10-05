import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { HarnessAgent } from '@ai-sdk/harness/agent';
import type { HarnessAgentSession } from '@ai-sdk/harness/agent';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { LocalSandbox } from './local-sandbox.js';

/** Where the agent works: a scratch directory on this machine, outside the repository. */
const WORKSPACE = join(tmpdir(), 'nest-profiler-ai-harness');

class CodingMessageDto {
  @ApiProperty({
    example: 'Write a small TypeScript helper that slugifies a title, in slugify.ts.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  prompt!: string;
}

/** One turn of the conversation, as the AI panel shows it. */
interface Turn {
  sessionId: string;
  /** The model that ran it, when the runtime reports one — Codex does not. */
  model: string;
  /** What the agent said over the whole turn, every step's text in order. */
  text: string;
  finishReason: string;
  /** Model calls the turn made — one per step of the runtime's own loop. */
  steps: number;
  /** Every tool the turn ran, in order: the runtime's built-ins (`Write`, `bash`…). */
  tools: string[];
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

/** An open conversation: the runtime's live session, and the sandbox it runs in. */
interface Conversation {
  session: HarnessAgentSession;
  sandbox: LocalSandbox;
}

@ApiTags('coding-agent')
@Controller('coding-agent')
export class CodingAgentController implements OnModuleDestroy {
  /** Open conversations, by session id — each holds a running Claude Code or Codex process. */
  private readonly conversations = new Map<string, Conversation>();

  constructor(
    // The generics are the agent's harness and tools, which this controller never looks inside.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject(HarnessAgent) private readonly agent: HarnessAgent<any, any>,
  ) {}

  @Post('sessions')
  @ApiOperation({
    summary: 'Start a conversation with Claude Code or Codex — its first `HarnessAgent` turn',
    description:
      'Returns the session id to continue it. Each turn is its own profile, under the ' +
      '`coding-agent` name and tagged with its harness (`harness:claude-code`, `harness:codex`), ' +
      'the runtime’s built-in tools tagged `harness`. The first turn installs the runtime, so ' +
      'it takes noticeably longer.',
  })
  async start(@Body() { prompt }: CodingMessageDto): Promise<Turn> {
    return this.turn(await this.open(), prompt);
  }

  @Post('sessions/:sessionId/messages')
  @ApiOperation({ summary: 'Send the next turn — the agent remembers the previous ones' })
  continue(
    @Param('sessionId') sessionId: string,
    @Body() { prompt }: CodingMessageDto,
  ): Promise<Turn> {
    return this.turn(this.find(sessionId), prompt);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  @ApiOperation({ summary: 'End a conversation, stopping its runtime' })
  async close(@Param('sessionId') sessionId: string): Promise<void> {
    const conversation = this.find(sessionId);
    this.conversations.delete(sessionId);
    await conversation.session.destroy();
    await conversation.sandbox.stop();
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.conversations.keys()].map((id) => this.close(id)));
  }

  private async turn({ session }: Conversation, prompt: string): Promise<Turn> {
    const result = await this.agent.generate({ session, prompt });
    return {
      sessionId: session.sessionId,
      model: result.response.modelId,
      // The final step is often a bare tool call: its own text alone would be empty.
      text: result.steps
        .map((step) => step.text.trim())
        .filter(Boolean)
        .join('\n\n'),
      finishReason: result.finishReason,
      steps: result.steps.length,
      tools: result.steps.flatMap((step) => step.toolCalls.map((call) => call.toolName)),
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
      },
    };
  }

  /** Opens a session of the agent, in a sandbox of its own on this machine. */
  private async open(): Promise<Conversation> {
    const sandbox = await LocalSandbox.open(WORKSPACE);
    const session = await this.agent.createSession({ sandboxSession: sandbox });
    const conversation = { session, sandbox };
    this.conversations.set(session.sessionId, conversation);
    return conversation;
  }

  private find(sessionId: string): Conversation {
    const conversation = this.conversations.get(sessionId);
    if (conversation === undefined) throw new NotFoundException(`No session ${sessionId}`);
    return conversation;
  }
}
