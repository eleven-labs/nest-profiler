import { DynamicModule, Module, Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import type { HttpInstrumentation } from './http-instrumentation.interface';
import { HttpClientCollector } from './http-client.collector';
import { HttpProfilerRecorder } from './http-profiler-recorder.service';
import { HttpInstrumentationRunner } from './http-instrumentation.runner';
import { HttpClientAssetRegistrar } from './http-client-asset.registrar';
import {
  ConfigurableModuleClass,
  HTTP_INSTRUMENTATIONS,
  type HttpCollectorModuleOptions,
  type HttpCollectorModuleAsyncOptions,
} from './http-collector.constants';

export type { HttpCollectorModuleOptions, HttpCollectorModuleAsyncOptions };

/** Collector-specific wiring for the active path, derived from the selected `instrumentations`. */
function httpShape(
  opts: Pick<HttpCollectorModuleOptions, 'instrumentations'>,
): CollectorModuleShape {
  const instrumentations: Type<HttpInstrumentation>[] = opts.instrumentations ?? [];

  return {
    // DiscoveryModule powers the axios adapter's provider auto-discovery. It is lightweight and
    // idempotent (the core profiler already imports it), so we import it whenever active rather
    // than couple this client-agnostic module to any specific adapter.
    imports: [DiscoveryModule],
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
 * Registers the client-agnostic "HTTP Client" panel and the {@link HttpProfilerRecorder}. Select
 * which HTTP client(s) to instrument via `instrumentations`, importing each adapter from its
 * subpath (`/axios`, `/fetch`) — nothing is instrumented unless listed. You can also record from
 * any other client via the exported recorder / {@link appendHttpRequestEntry}.
 *
 * ```ts
 * import { AxiosInstrumentation } from '@eleven-labs/nest-profiler-http/axios';
 * import { FetchInstrumentation } from '@eleven-labs/nest-profiler-http/fetch';
 *
 * HttpCollectorModule.forRoot({ instrumentations: [AxiosInstrumentation, FetchInstrumentation] });
 * ```
 */
@Module({})
export class HttpCollectorModule extends ConfigurableModuleClass {
  static forRoot(options: HttpCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, httpShape(options));
  }

  /** Async variant — resolve the capture options (e.g. `captureResponseBody`) from DI. */
  static forRootAsync(options: HttpCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, httpShape(options));
  }
}
