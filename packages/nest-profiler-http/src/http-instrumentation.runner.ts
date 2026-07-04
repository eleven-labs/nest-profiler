import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { HttpInstrumentation } from './http-instrumentation.interface';
import { HttpProfilerRecorder } from './http-profiler-recorder.service';
import { HTTP_INSTRUMENTATIONS } from './http-collector.constants';

/**
 * Installs every registered {@link HttpInstrumentation} once the application
 * has booted, handing each the shared {@link HttpProfilerRecorder}.
 */
@Injectable()
export class HttpInstrumentationRunner implements OnApplicationBootstrap {
  private readonly logger = new Logger(HttpInstrumentationRunner.name);

  constructor(
    @Inject(HTTP_INSTRUMENTATIONS) private readonly instrumentations: HttpInstrumentation[],
    private readonly recorder: HttpProfilerRecorder,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const instrumentation of this.instrumentations) {
      // Isolate each install: a failing (e.g. custom) instrumentation must never take down the
      // host application's bootstrap — the profiler is meant to be inert on failure.
      try {
        await instrumentation.install(this.recorder);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `HTTP instrumentation "${instrumentation.constructor.name}" failed to install: ${message}`,
        );
      }
    }
  }
}
