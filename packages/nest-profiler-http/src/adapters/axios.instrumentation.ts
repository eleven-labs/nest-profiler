import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { HttpService } from '@nestjs/axios';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { HttpInstrumentation } from '../http-instrumentation.interface';
import type { HttpProfilerRecorder } from '../http-profiler-recorder.service';

interface ProfilerAxiosConfig extends InternalAxiosRequestConfig {
  _profilerStart?: number;
  _profilerRequestBody?: unknown;
}

/**
 * Built-in {@link HttpInstrumentation} for `@nestjs/axios`. Patches the
 * `HttpService`'s `axiosRef` interceptors and records each request/response on
 * the active profile via the {@link HttpProfilerRecorder}. `@nestjs/axios` and
 * `axios` are optional peers — if `HttpService` cannot be resolved, it no-ops.
 */
@Injectable()
export class AxiosInstrumentation implements HttpInstrumentation {
  constructor(private readonly moduleRef: ModuleRef) {}

  async install(recorder: HttpProfilerRecorder): Promise<void> {
    let httpService: HttpService | undefined;
    try {
      httpService = await this.moduleRef.resolve<HttpService>(HttpService, undefined, {
        strict: false,
      });
    } catch {
      return;
    }

    if (!httpService?.axiosRef) return;

    // Guard against registering the interceptors twice if install runs again
    // (e.g. multiple application contexts sharing the same axios instance).
    const axiosRef = httpService.axiosRef as typeof httpService.axiosRef & {
      __profilerPatched?: boolean;
    };
    if (axiosRef.__profilerPatched) return;
    axiosRef.__profilerPatched = true;

    axiosRef.interceptors.request.use((config: ProfilerAxiosConfig) => {
      config._profilerStart = Date.now();
      // Stash the body before axios serialises it (transformRequest runs after
      // request interceptors), so the panel shows the original payload.
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
