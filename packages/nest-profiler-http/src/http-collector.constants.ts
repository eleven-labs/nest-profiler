import { ConfigurableModuleBuilder, Type } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';
import type { HttpCaptureOptions } from './http-request.interface';
import type { HttpInstrumentation } from './http-instrumentation.interface';

export interface HttpCollectorModuleOptions extends HttpCaptureOptions {
  /** Enable the collector. Default: `true`. */
  enabled?: boolean;

  /**
   * The HTTP-client instrumentations to install. Nothing is instrumented unless a client is
   * listed here — select each by importing its class from the matching subpath:
   *
   * ```ts
   * import { AxiosInstrumentation } from '@eleven-labs/nest-profiler-http/axios';
   * import { FetchInstrumentation } from '@eleven-labs/nest-profiler-http/fetch';
   *
   * HttpCollectorModule.forRoot({ instrumentations: [AxiosInstrumentation, FetchInstrumentation] });
   * ```
   *
   * Bring your own client by implementing {@link HttpInstrumentation} and adding it to the list.
   */
  instrumentations?: Type<HttpInstrumentation>[];
}

/** Async configuration for `HttpCollectorModule.forRootAsync`. */
export type HttpCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<HttpCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
    /** The HTTP-client instrumentations to install (selected at module-build time). */
    instrumentations?: Type<HttpInstrumentation>[];
  };

/** DI token holding the resolved {@link HttpCollectorModuleOptions}. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: HTTP_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<HttpCollectorModuleOptions>().setClassMethodName('forRoot').build();

/** DI token holding the array of registered {@link HttpInstrumentation} instances. */
export const HTTP_INSTRUMENTATIONS = Symbol('HTTP_INSTRUMENTATIONS');
