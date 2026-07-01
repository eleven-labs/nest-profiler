import { BadRequestException, Controller, Get, Logger } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProfilerService } from '@eleven-labs/nest-profiler';

/**
 * Artificial endpoints that showcase profiler features (nested timeline spans, exception capture).
 * Not real business logic — kept together as a diagnostics surface for the demo.
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

  @Get('error')
  @ApiOperation({ summary: 'Throws a BadRequestException — tests the profiler exception capture' })
  @ApiResponse({ status: 400, description: 'Simulated error for profiler testing' })
  throwError(): never {
    this.logger.error('Simulated error endpoint hit');
    throw new BadRequestException('This is a simulated error for profiler testing');
  }
}
