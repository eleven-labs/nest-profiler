import { DynamicModule, Module, Type } from '@nestjs/common';
import { buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import type { HttpInstrumentation } from './http-instrumentation.interface';
import { HttpClientCollector } from './http-client.collector';
import { HttpProfilerRecorder } from './http-profiler-recorder.service';
import { HttpInstrumentationRunner } from './http-instrumentation.runner';
import { HttpClientAssetRegistrar } from './http-client-asset.registrar';
import { AxiosInstrumentation } from './adapters/axios.instrumentation';
import {
  ConfigurableModuleClass,
  HTTP_INSTRUMENTATIONS,
  type HttpCollectorModuleOptions,
  type HttpCollectorModuleAsyncOptions,
} from './http-collector.constants';

export type { HttpCollectorModuleOptions, HttpCollectorModuleAsyncOptions };

/** Collector-specific wiring for the active path, derived from the build-time `axios`/`instrumentations` flags. */
function httpShape(
  opts: Pick<HttpCollectorModuleOptions, 'axios' | 'instrumentations'>,
): CollectorModuleShape {
  const instrumentations: Type<HttpInstrumentation>[] = [
    ...(opts.axios !== false ? [AxiosInstrumentation] : []),
    ...(opts.instrumentations ?? []),
  ];

  return {
    providers: [
      HttpProfilerRecorder,
      HttpClientCollector,
      HttpClientAssetRegistrar,
      ...instrumentations,
      {
        provide: HTTP_INSTRUMENTATIONS,
        useFactory: (...instances: HttpInstrumentation[]) => instances,
        inject: instrumentations,
      },
      HttpInstrumentationRunner,
    ],
    exports: [HttpProfilerRecorder],
    // Keep the (no-op) recorder injectable so consumers who inject it never fail DI.
    disabled: (base) => ({
      module: base.module,
      imports: base.imports,
      providers: [...(base.providers ?? []), HttpProfilerRecorder],
      exports: [HttpProfilerRecorder],
    }),
  };
}

/**
 * Registers the client-agnostic "HTTP Client" panel and the {@link HttpProfilerRecorder}, plus
 * any HTTP instrumentations (axios by default). Record axios traffic by handing the module your
 * `HttpService.axiosRef` (see {@link forRootAsync}), or record from any other client via the
 * exported recorder / {@link appendHttpRequestEntry}.
 */
@Module({})
export class HttpCollectorModule extends ConfigurableModuleClass {
  static forRoot(options: HttpCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, httpShape(options));
  }

  /**
   * Async variant — resolve the options (notably `axiosRef`) from DI. This is the idiomatic way
   * to wire the axios instrumentation without this package depending on `@nestjs/axios`:
   *
   * ```ts
   * HttpCollectorModule.forRootAsync({
   *   inject: [HttpService],
   *   useFactory: (http: HttpService) => ({ axiosRef: http.axiosRef, captureResponseBody: true }),
   * });
   * ```
   */
  static forRootAsync(options: HttpCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, httpShape(options));
  }
}
