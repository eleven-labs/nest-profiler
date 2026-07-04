import { Inject, Injectable } from '@nestjs/common';
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { HttpInstrumentation } from '../http-instrumentation.interface';
import type { HttpProfilerRecorder } from '../http-profiler-recorder.service';
import type { HttpCaptureOptions } from '../http-request.interface';
import { HTTP_COLLECTOR_OPTIONS } from '../http-collector.constants';

interface ProfilerAxiosConfig extends InternalAxiosRequestConfig {
  _profilerStart?: number;
  _profilerRequestBody?: unknown;
}

type PatchableAxios = AxiosInstance & { __profilerPatched?: boolean };

/**
 * Built-in {@link HttpInstrumentation} for axios. It patches the `axiosRef` interceptors and
 * records each request/response on the active profile via {@link HttpProfilerRecorder}.
 *
 * This package intentionally has **no dependency on `@nestjs/axios`** (nor a lazy `require` of
 * it): the axios instance to instrument is supplied by the host application through
 * `options.axiosRef` — typically wired with `HttpCollectorModule.forRootAsync({ inject:
 * [HttpService], useFactory: (http) => ({ axiosRef: http.axiosRef }) })`. Only `axios`'s *types*
 * are referenced (type-only imports, erased at build). Pass an array of refs to instrument
 * several `HttpService` instances.
 */
@Injectable()
export class AxiosInstrumentation implements HttpInstrumentation {
  constructor(@Inject(HTTP_COLLECTOR_OPTIONS) private readonly options: HttpCaptureOptions) {}

  install(recorder: HttpProfilerRecorder): void {
    const refs = this.options.axiosRef;
    const list = Array.isArray(refs) ? refs : refs ? [refs] : [];
    for (const ref of list) this.patch(ref, recorder);
  }

  private patch(axiosRef: PatchableAxios, recorder: HttpProfilerRecorder): void {
    // No axiosRef provided, or already patched (idempotent across re-inits / shared instances).
    if (!axiosRef?.interceptors?.request || axiosRef.__profilerPatched) return;
    axiosRef.__profilerPatched = true;

    axiosRef.interceptors.request.use((config: ProfilerAxiosConfig) => {
      config._profilerStart = Date.now();
      // Stash the body before axios serialises it (transformRequest runs after request
      // interceptors), so the panel shows the original payload.
      config._profilerRequestBody = config.data;
      return config;
    });

    axiosRef.interceptors.response.use(
      (response: AxiosResponse) => {
        this.capture(recorder, response.config as ProfilerAxiosConfig, response, undefined);
        return response;
      },
      (error: Error & { config?: ProfilerAxiosConfig; response?: AxiosResponse }) => {
        this.capture(recorder, error.config ?? {}, error.response, error.message);
        return Promise.reject(error);
      },
    );
  }

  private capture(
    recorder: HttpProfilerRecorder,
    config: Partial<ProfilerAxiosConfig>,
    response: AxiosResponse | undefined,
    error: string | undefined,
  ): void {
    recorder.capture({
      method: typeof config.method === 'string' ? config.method : 'GET',
      url: resolveRequestUrl(config),
      startedAt: config._profilerStart ?? Date.now(),
      duration: config._profilerStart ? Date.now() - config._profilerStart : 0,
      statusCode: response?.status,
      error,
      requestHeaders: config.headers,
      requestBody: config._profilerRequestBody,
      responseHeaders: response?.headers,
      responseBody: response?.data,
    });
  }
}

function resolveRequestUrl(config: Partial<ProfilerAxiosConfig>): string {
  const baseUrl = typeof config.baseURL === 'string' ? config.baseURL : '';
  const rawUrl = typeof config.url === 'string' ? config.url : '?';
  if (baseUrl && rawUrl !== '?' && !rawUrl.startsWith('http')) {
    return baseUrl + rawUrl;
  }
  return rawUrl;
}
