import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import type { FactoryProvider, ModuleMetadata } from '@nestjs/common';
import type { HttpCaptureOptions } from './http-request.interface';
import type { HttpInstrumentation } from './http-instrumentation.interface';
import { HttpClientCollector } from './http-client.collector';
import { HttpProfilerRecorder } from './http-profiler-recorder.service';
import { HttpInstrumentationRunner } from './http-instrumentation.runner';
import { HttpClientAssetRegistrar } from './http-client-asset.registrar';
import { AxiosInstrumentation } from './adapters/axios.instrumentation';
import { HTTP_COLLECTOR_OPTIONS, HTTP_INSTRUMENTATIONS } from './http-collector.constants';

export interface HttpCollectorModuleOptions extends HttpCaptureOptions {
  /** Enable the collector. Default: `true`. */
  enabled?: boolean;

  /**
   * Enable the built-in axios instrumentation. Default: `true`. It instruments the
   * `axiosRef` you provide via `axiosRef` (see {@link forRootAsync}); with no `axiosRef` it is
   * a harmless no-op. This package never imports `@nestjs/axios`.
   */
  axios?: boolean;

  /**
   * Additional {@link HttpInstrumentation} providers to install (e.g. a custom
   * fetch/got/undici adapter).
   */
  instrumentations?: Type<HttpInstrumentation>[];
}

/** Async configuration for {@link HttpCollectorModule.forRootAsync}. */
export interface HttpCollectorModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  /** Providers to inject into `useFactory` (e.g. `HttpService` from `@nestjs/axios`). */
  inject?: FactoryProvider['inject'];
  /** Factory returning the collector options — the place to supply `axiosRef`. */
  useFactory: FactoryProvider<
    HttpCollectorModuleOptions | Promise<HttpCollectorModuleOptions>
  >['useFactory'];
  /** Synchronous enable flag (decided at module-build time, not by the factory). */
  enabled?: boolean;
  /** Enable the built-in axios instrumentation. Default: `true`. */
  axios?: boolean;
  /** Additional instrumentation providers. */
  instrumentations?: Type<HttpInstrumentation>[];
}

/**
 * Registers the client-agnostic "HTTP Client" panel and the {@link HttpProfilerRecorder}, plus
 * any HTTP instrumentations (axios by default). Record axios traffic by handing the module your
 * `HttpService.axiosRef` (see {@link forRootAsync}), or record from any other client via the
 * exported recorder / {@link appendHttpRequestEntry}.
 */
@Module({})
export class HttpCollectorModule {
  static forRoot(options: HttpCollectorModuleOptions = {}): DynamicModule {
    return this.build({ provide: HTTP_COLLECTOR_OPTIONS, useValue: options }, options);
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
    return this.build(
      {
        provide: HTTP_COLLECTOR_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject ?? [],
      },
      options,
      options.imports,
    );
  }

  /** Shared wiring for the sync/async paths — only the options provider differs. */
  private static build(
    optionsProvider: Provider,
    opts: Pick<HttpCollectorModuleOptions, 'enabled' | 'axios' | 'instrumentations'>,
    imports: ModuleMetadata['imports'] = [],
  ): DynamicModule {
    if (opts.enabled === false) {
      // Keep the (no-op) recorder injectable so consumers who inject it never fail DI.
      return {
        module: HttpCollectorModule,
        imports,
        providers: [optionsProvider, HttpProfilerRecorder],
        exports: [HttpProfilerRecorder],
      };
    }

    const instrumentations: Type<HttpInstrumentation>[] = [
      ...(opts.axios !== false ? [AxiosInstrumentation] : []),
      ...(opts.instrumentations ?? []),
    ];

    return {
      module: HttpCollectorModule,
      imports,
      providers: [
        optionsProvider,
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
    };
  }
}
