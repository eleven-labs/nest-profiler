import { BadRequestException, Controller, Get, Logger } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProfilerService } from '@eleven-labs/nest-profiler';

@ApiTags('app')
@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(private readonly profiler: ProfilerService) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  @ApiResponse({ status: 200, description: 'Application is healthy' })
  getHealth(): Record<string, string> {
    this.logger.log('Health check');
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /**
   * Simulates a slow operation with multiple DB-like spans.
   * Check the Timeline panel in /_profiler to see nested spans.
   */
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

  /**
   * Throws a BadRequestException — useful for testing the profiler error capture.
   */
  @Get('error')
  @ApiOperation({ summary: 'Throws a BadRequestException — tests the profiler exception capture' })
  @ApiResponse({ status: 400, description: 'Simulated error for profiler testing' })
  throwError(): never {
    this.logger.error('Simulated error endpoint hit');
    throw new BadRequestException('This is a simulated error for profiler testing');
  }
}
