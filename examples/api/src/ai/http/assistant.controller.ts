import { Body, Controller, NotFoundException, Param, Post, Query, Res, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { pipeTextStreamToResponse, toTextStream } from 'ai';
import { Observable, from, map } from 'rxjs';
import { AssistantService } from '../application/assistant.service.js';
import { AskDto } from './dto/ask.dto.js';
import { ApprovalDecisionDto } from './dto/approval.dto.js';
import { DescribeDto } from './dto/describe.dto.js';
import type { ApprovalOutcome, ArticleDigest, AssistantAnswer } from '../domain/assistant.js';
import type { PlatformResponse } from '../../shared/platform-response.js';

@ApiTags('ai')
@Controller('ai')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('ask')
  @ApiOperation({
    summary: 'Ask the model and wait for the whole answer — the non-streaming baseline',
    description:
      'One request, one JSON answer. Compare its profile with the two streaming endpoints below: ' +
      'same AI panel, but the Response tab reports no stream and the duration is the model call.',
  })
  @ApiResponse({ status: 201, description: 'Answer — check the AI panel in /_profiler' })
  ask(@Body() dto: AskDto): Promise<AssistantAnswer> {
    return this.assistant.ask(dto.prompt);
  }

  @Post('agent')
  @ApiOperation({
    summary: 'Ask with tools — one model call per round trip, plus every tool the model ran',
    description:
      'The AI panel shows the whole loop: the system prompt, the conversation sent at each step, ' +
      'the tools declared with their schemas, the tool calls the model asked for, and each tool ' +
      'execution with its input, output and duration.',
  })
  @ApiResponse({ status: 201, description: 'Answer — check the AI panel in /_profiler' })
  runAgent(@Body() dto: AskDto): Promise<AssistantAnswer> {
    return this.assistant.runAgent(dto.prompt);
  }

  @Post('object')
  @ApiOperation({
    summary: 'Structured output — the model fills a JSON Schema instead of writing prose',
    description:
      'The AI panel shows the output strategy, the schema the model had to satisfy and the object ' +
      'that came back, beside the usual call figures.',
  })
  @ApiResponse({ status: 201, description: 'A schema-checked digest of the text' })
  digest(@Body() dto: AskDto): Promise<ArticleDigest> {
    return this.assistant.digest(dto.prompt);
  }

  @Post('describe')
  @ApiOperation({
    summary: 'Ask about an attachment — a file part sent beside the question',
    description:
      'The AI panel records what was attached (media type, size or URL) and never the bytes. ' +
      'Needs a model that accepts the media type; the default free model is text-only.',
  })
  @ApiResponse({ status: 201, description: "The model's answer about the attachment" })
  describe(@Body() dto: DescribeDto): Promise<AssistantAnswer> {
    return this.assistant.describe(dto.prompt, {
      url: dto.url,
      mediaType: dto.mediaType ?? 'image/png',
    });
  }

  @Post('approval')
  @ApiOperation({
    summary: 'Human in the loop — the model asks before a destructive tool runs',
    description:
      'Returns `awaiting-approval` with a `pendingId` when the model wants to call the guarded ' +
      'tool. The AI panel shows the approval request; post the decision to resume.',
  })
  @ApiResponse({ status: 201, description: 'Either an approval request or a plain answer' })
  requestApproval(@Body() dto: AskDto): Promise<ApprovalOutcome> {
    return this.assistant.requestApproval(dto.prompt);
  }

  @Post('approval/:pendingId')
  @ApiOperation({
    summary: 'Answer a pending approval — the second half of the exchange',
    description:
      "This request's own profile carries the approval response, and the tool execution only if " +
      'it was granted.',
  })
  @ApiParam({ name: 'pendingId', description: 'The id returned by POST /ai/approval' })
  @ApiResponse({ status: 201, description: 'The answer the model gave after the decision' })
  @ApiResponse({ status: 404, description: 'No pending approval under that id' })
  async resolveApproval(
    @Param('pendingId') pendingId: string,
    @Body() dto: ApprovalDecisionDto,
  ): Promise<AssistantAnswer> {
    const answer = await this.assistant.resolveApproval(pendingId, dto.approved);
    if (!answer) throw new NotFoundException(`No pending approval ${pendingId}`);
    return answer;
  }

  @Post('stream')
  @ApiOperation({
    summary: 'Stream the answer as raw text chunks (AI SDK → Node response)',
    description:
      'The handler returns as soon as the stream is opened; the transport keeps writing for as ' +
      'long as the model generates. The Response tab reports time to first chunk, chunk count ' +
      'and bytes, and the request duration covers the whole stream.',
  })
  @ApiResponse({ status: 200, description: 'text/plain stream of tokens' })
  streamText(@Body() dto: AskDto, @Res() response: PlatformResponse): void {
    const result = this.assistant.stream(dto.prompt);
    // Not awaited on purpose: the handler returns as soon as the stream is opened, which is the
    // shape the profiler has to cope with.
    void pipeTextStreamToResponse({ response, stream: toTextStream({ stream: result.stream }) });
  }

  @Sse('sse')
  @ApiOperation({
    summary: 'Stream the answer as Server-Sent Events (NestJS @Sse)',
    description:
      'Same stream, delivered the NestJS way. Profiled identically — the profiler measures what ' +
      'the transport wrote, not how the handler produced it.',
  })
  @ApiQuery({ name: 'prompt', example: 'Explain what a web profiler is, in two sentences.' })
  @ApiResponse({ status: 200, description: 'text/event-stream of token deltas' })
  streamSse(@Query('prompt') prompt: string): Observable<MessageEvent> {
    const result = this.assistant.stream(prompt);
    return from(result.textStream).pipe(
      map((delta) => ({ data: { delta } }) satisfies MessageEvent),
    );
  }
}
