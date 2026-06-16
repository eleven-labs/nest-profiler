import { Injectable, Optional } from '@nestjs/common';
import { ProfilerService } from '@eleven-labs/nest-profiler';
import { HttpProfilerRecorder } from '@eleven-labs/nest-profiler-http';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/**
 * Demonstrates the client-agnostic API: an outgoing call made with the native
 * `fetch` (no axios) is recorded with `HttpProfilerRecorder.capture(...)`, so it
 * shows up in the same HTTP Client panel as the axios calls.
 */
@Injectable()
export class PostsFetchService {
  private readonly logger?: PinoLogger;

  constructor(
    private readonly profiler: ProfilerService,
    // Optional so the service still works when the profiler (and thus the HTTP
    // collector) is disabled — recording then becomes a no-op.
    @Optional() private readonly recorder?: HttpProfilerRecorder,
    @Optional()
    @InjectPinoLogger(PostsFetchService.name)
    pinoLogger?: PinoLogger,
  ) {
    this.logger = pinoLogger ? this.profiler.createLogger(pinoLogger) : undefined;
  }

  /** Fetch a single post with the native fetch API and record it. */
  async fetchFirstPost(): Promise<unknown> {
    const url = 'https://jsonplaceholder.typicode.com/posts/1';
    const requestHeaders = { accept: 'application/json' };

    const startedAt = Date.now();
    const stop = this.profiler.startSpan('fetch.post');
    const response = await fetch(url, { headers: requestHeaders });
    const body: unknown = await response.json();
    stop();

    // `capture` applies the configured capture flags + header masking for us.
    this.recorder?.capture({
      method: 'GET',
      url,
      startedAt,
      duration: Date.now() - startedAt,
      statusCode: response.status,
      requestHeaders,
      responseHeaders: response.headers,
      responseBody: body,
    });

    this.logger?.info(`Fetched post via native fetch: ${url}`);
    return body;
  }
}
