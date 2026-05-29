import { DynamicModule, Module } from '@nestjs/common';
import { AXIOS_COLLECTOR_OPTIONS } from './axios-collector.interface';
import { AxiosCollector } from './axios.collector';
import { AxiosInterceptorPatch } from './axios-interceptor.patch';

export interface AxiosCollectorModuleOptions {
  /** Enable the collector. Default: `true`. */
  enabled?: boolean;

  /**
   * Capture outgoing request headers. Default: `true`.
   * Sensitive headers are masked — see `maskHeaders`.
   */
  captureRequestHeaders?: boolean;

  /**
   * Capture outgoing request body for non-GET/HEAD methods. Default: `true`.
   */
  captureRequestBody?: boolean;

  /**
   * Capture incoming response headers. Default: `true`.
   * Sensitive headers are masked — see `maskHeaders`.
   */
  captureResponseHeaders?: boolean;

  /**
   * Capture incoming response body. Default: `false`.
   * Enable with caution — response bodies can be large.
   */
  captureResponseBody?: boolean;

  /**
   * Header names (lowercase) whose values are replaced with `[REDACTED]`.
   * Merged with the built-in list: `authorization`, `cookie`, `set-cookie`,
   * `x-api-key`, `x-auth-token`, `proxy-authorization`.
   */
  maskHeaders?: string[];
}

@Module({})
export class AxiosCollectorModule {
  static forRoot(options: AxiosCollectorModuleOptions = {}): DynamicModule {
    if (options.enabled === false) return { module: AxiosCollectorModule };
    return {
      module: AxiosCollectorModule,
      providers: [
        { provide: AXIOS_COLLECTOR_OPTIONS, useValue: options },
        AxiosInterceptorPatch,
        AxiosCollector,
      ],
    };
  }
}
