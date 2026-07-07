import { ConfigurableModuleBuilder, Type } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';
import type { HttpCaptureOptions } from './http-request.interface';
import type { HttpInstrumentation } from './http-instrumentation.interface';

export interface HttpCollectorModuleOptions extends HttpCaptureOptions {
  /** Enable the collector. Default: `true`. */
  enabled?: boolean;

  /**
   * Enable the built-in axios instrumentation. Default: `true`. It instruments the
   * `axiosRef` you provide via `axiosRef` (see {@link HttpCollectorModuleAsyncOptions}); with no
   * `axiosRef` it is a harmless no-op. This package never imports `@nestjs/axios`.
   */
  axios?: boolean;

  /**
   * Additional {@link HttpInstrumentation} providers to install (e.g. a custom
   * fetch/got/undici adapter).
   */
  instrumentations?: Type<HttpInstrumentation>[];
}

/** Async configuration for `HttpCollectorModule.forRootAsync`. */
export type HttpCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<HttpCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
    /** Enable the built-in axios instrumentation. Default: `true`. */
    axios?: boolean;
    /** Additional instrumentation providers. */
    instrumentations?: Type<HttpInstrumentation>[];
  };

/** DI token holding the resolved {@link HttpCollectorModuleOptions}. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: HTTP_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<HttpCollectorModuleOptions>().setClassMethodName('forRoot').build();

/** DI token holding the array of registered {@link HttpInstrumentation} instances. */
export const HTTP_INSTRUMENTATIONS = Symbol('HTTP_INSTRUMENTATIONS');
