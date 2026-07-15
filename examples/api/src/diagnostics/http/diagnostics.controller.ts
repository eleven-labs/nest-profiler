import { Controller, Get, InternalServerErrorException, Logger } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProfilerService } from '@eleven-labs/nest-profiler';

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

  constructor(private readonly profiler: ProfilerService) {}

  @Get('slow')
  @ApiOperation({ summary: 'Simulate a slow request with nested timeline spans' })
  @ApiResponse({ status: 200, description: 'Completed — check the Timeline panel in /_profiler' })
  async slowEndpoint(): Promise<Record<string, unknown>> {
    const stopTotal = this.profiler.startSpan('slow.total');

    const stopA = this.profiler.startSpan('slow.step.fetch');
    await new Promise((r) => setTimeout(r, 30));
    stopA();

    const stopB = this.profiler.startSpan('slow.step.process');
    await new Promise((r) => setTimeout(r, 20));
    stopB();

    const stopC = this.profiler.startSpan('slow.step.serialize');
    await new Promise((r) => setTimeout(r, 10));
    stopC();

    stopTotal();
    this.logger.log('Slow endpoint completed');
    return { message: 'Slow operation completed — check the Timeline panel in /_profiler' };
  }

  @Get('crash')
  @ApiOperation({
    summary: 'Throws a 500 — the profiler tags it `error` and the Errors filter keeps it',
  })
  @ApiResponse({ status: 500, description: 'Simulated server failure for profiler testing' })
  crash(): never {
    this.logger.error('Simulated crash endpoint hit');
    throw new InternalServerErrorException('This is a simulated crash for profiler testing');
  }
}
