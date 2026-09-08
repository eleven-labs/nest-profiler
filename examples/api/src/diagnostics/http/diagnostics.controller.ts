import { Controller, Get, InternalServerErrorException, Logger } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TracerService } from '@eleven-labs/nest-profiler';

/**
 * Artificial endpoints that showcase profiler features (nested timeline spans, a server failure).
 * Not real business logic — kept together as a diagnostics surface for the demo.
 *
 * There is deliberately no endpoint throwing a `BadRequestException`: rejecting an invalid
 * `POST /api/v1/products` already produces a real 400 with a captured exception, which is a
 * truer demo than an artificial one.
 */
@ApiTags('diagnostics')
@Controller()
export class DiagnosticsController {
  private readonly logger = new Logger(DiagnosticsController.name);

  constructor(private readonly tracer: TracerService) {}

  @Get('slow')
  @ApiOperation({ summary: 'Simulate a slow request with nested timeline spans' })
  @ApiResponse({ status: 200, description: 'Completed — check the Performance tab in /_profiler' })
  async slowEndpoint(): Promise<Record<string, unknown>> {
    // Nested `span()` calls produce a real tree in the waterfall: the three steps are drawn
    // *inside* `slow.total`, because each one opened while it was the active span. Nothing links
    // them explicitly — the async context does it.
    await this.tracer.span('slow.total', async (span) => {
      await this.tracer.span('slow.step.fetch', () => new Promise((r) => setTimeout(r, 30)));
      await this.tracer.span('slow.step.process', () => new Promise((r) => setTimeout(r, 20)));
      await this.tracer.span('slow.step.serialize', () => new Promise((r) => setTimeout(r, 10)));
      span.setTag('steps', 3);
    });

    this.logger.log('Slow endpoint completed');
    return { message: 'Slow operation completed — check the Performance tab in /_profiler' };
  }

  @Get('crash')
  @ApiOperation({
    summary: 'Throws a 500 — the profiler tags it `error` and the Errors filter keeps it',
  })
  @ApiResponse({ status: 500, description: 'Simulated server failure for profiler testing' })
  crash(): never {
    this.logger.error('Simulated crash endpoint hit');
    // Thrown with a `cause`, the way a layered application reports a failure: the outer
    // exception is what the client sees, the cause is what the Exceptions tab needs to show —
    // "internal server error" explains nothing on its own.
    throw new InternalServerErrorException('This is a simulated crash for profiler testing', {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
        code: 'ECONNREFUSED',
      }),
    });
  }
}
