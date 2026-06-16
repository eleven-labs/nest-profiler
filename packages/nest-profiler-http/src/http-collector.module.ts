import { DynamicModule, Module, Type } from '@nestjs/common';
import type { HttpCaptureOptions } from './http-request.interface';
import type { HttpInstrumentation } from './http-instrumentation.interface';
import { HttpClientCollector } from './http-client.collector';
import { HttpProfilerRecorder } from './http-profiler-recorder.service';
import { HttpInstrumentationRunner } from './http-instrumentation.runner';
import { AxiosInstrumentation } from './adapters/axios.instrumentation';
import { HTTP_COLLECTOR_OPTIONS, HTTP_INSTRUMENTATIONS } from './http-collector.constants';

export interface HttpCollectorModuleOptions extends HttpCaptureOptions {
  /** Enable the collector. Default: `true`. */
  enabled?: boolean;

  /**
   * Enable the built-in axios instrumentation (`@nestjs/axios` `HttpService`).
   * Default: `true`. No-op when `@nestjs/axios` is not installed, so it is safe
   * to leave on for non-axios apps.
   */
  axios?: boolean;

  /**
   * Additional {@link HttpInstrumentation} providers to install (e.g. a custom
   * fetch/got/undici adapter).
   */
  instrumentations?: Type<HttpInstrumentation>[];
}

/**
 * Registers the client-agnostic "HTTP Client" panel and the
 * {@link HttpProfilerRecorder}, plus any HTTP instrumentations (axios by
 * default). Import it once; record requests from axios automatically, or from
 * any other client via the exported recorder / {@link appendHttpRequestEntry}.
 */
@Module({})
export class HttpCollectorModule {
  static forRoot(options: HttpCollectorModuleOptions = {}): DynamicModule {
    if (options.enabled === false) return { module: HttpCollectorModule };

    const instrumentations: Type<HttpInstrumentation>[] = [
      ...(options.axios !== false ? [AxiosInstrumentation] : []),
      ...(options.instrumentations ?? []),
    ];

    return {
      module: HttpCollectorModule,
      providers: [
        { provide: HTTP_COLLECTOR_OPTIONS, useValue: options },
        HttpProfilerRecorder,
        HttpClientCollector,
        ...instrumentations,
        {
          provide: HTTP_INSTRUMENTATIONS,
          useFactory: (...instances: HttpInstrumentation[]) => instances,
          inject: instrumentations,
        },
        HttpInstrumentationRunner,
      ],
      exports: [HttpProfilerRecorder],
    };
  }
}
