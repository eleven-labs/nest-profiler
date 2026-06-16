import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import type { HttpInstrumentation } from './http-instrumentation.interface';
import { HttpProfilerRecorder } from './http-profiler-recorder.service';
import { HTTP_INSTRUMENTATIONS } from './http-collector.constants';

/**
 * Installs every registered {@link HttpInstrumentation} once the application
 * has booted, handing each the shared {@link HttpProfilerRecorder}.
 */
@Injectable()
export class HttpInstrumentationRunner implements OnApplicationBootstrap {
  constructor(
    @Inject(HTTP_INSTRUMENTATIONS) private readonly instrumentations: HttpInstrumentation[],
    private readonly recorder: HttpProfilerRecorder,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const instrumentation of this.instrumentations) {
      await instrumentation.install(this.recorder);
    }
  }
}
