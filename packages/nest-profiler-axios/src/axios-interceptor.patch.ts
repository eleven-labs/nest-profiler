import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { HttpService } from '@nestjs/axios';
import { ClsService } from 'nestjs-cls';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { Profile } from '@eleven-labs/nest-profiler';
import { appendCollectorEntry } from '@eleven-labs/nest-profiler';
import {
  AXIOS_COLLECTOR_OPTIONS,
  AXIOS_REQUESTS_KEY,
  DEFAULT_MASK_HEADERS,
  type HttpRequestEntry,
} from './axios-collector.interface';
import type { AxiosCollectorModuleOptions } from './axios-collector.module';

interface ProfilerAxiosConfig extends InternalAxiosRequestConfig {
  _profilerStart?: number;
  _profilerRequestHeaders?: Record<string, string>;
  _profilerRequestBody?: unknown;
}

@Injectable()
export class AxiosInterceptorPatch implements OnApplicationBootstrap {
  constructor(
    private readonly cls: ClsService,
    private readonly moduleRef: ModuleRef,
    @Inject(AXIOS_COLLECTOR_OPTIONS) private readonly options: AxiosCollectorModuleOptions,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    let httpService: HttpService | undefined;
    try {
      httpService = await this.moduleRef.resolve<HttpService>(HttpService, undefined, {
        strict: false,
      });
    } catch {
      return;
    }

    if (!httpService?.axiosRef) return;

    const opts = this.options;
    const maskHeaders = [...DEFAULT_MASK_HEADERS, ...(opts.maskHeaders ?? [])];

    httpService.axiosRef.interceptors.request.use((config: ProfilerAxiosConfig) => {
      config._profilerStart = Date.now();

      if (opts.captureRequestHeaders !== false) {
        config._profilerRequestHeaders = extractHeaders(config.headers, maskHeaders);
      }

      const method = (typeof config.method === 'string' ? config.method : 'GET').toUpperCase();
      if (
        opts.captureRequestBody !== false &&
        method !== 'GET' &&
        method !== 'HEAD' &&
        config.data != null
      ) {
        config._profilerRequestBody = config.data;
      }

      return config;
    });

    httpService.axiosRef.interceptors.response.use(
      (response: AxiosResponse) => {
        this.pushEntry(response.config as ProfilerAxiosConfig, response, undefined, maskHeaders);
        return response;
      },
      (error: Error & { config?: ProfilerAxiosConfig; response?: AxiosResponse }) => {
        this.pushEntry(error.config ?? {}, error.response, error.message, maskHeaders);
        return Promise.reject(error);
      },
    );
  }

  private pushEntry(
    config: Partial<ProfilerAxiosConfig>,
    response: AxiosResponse | undefined,
    error: string | undefined,
    maskHeaders: string[],
  ): void {
    const opts = this.options;
    const duration = config._profilerStart ? Date.now() - config._profilerStart : 0;

    const entry: HttpRequestEntry = {
      method: (typeof config.method === 'string' ? config.method : 'GET').toUpperCase(),
      url: resolveRequestUrl(config),
      statusCode: response?.status,
      duration,
      startedAt: config._profilerStart ?? Date.now(),
      error,
      requestHeaders: config._profilerRequestHeaders,
      requestBody: config._profilerRequestBody,
    };

    if (response) {
      if (opts.captureResponseHeaders !== false) {
        entry.responseHeaders = extractHeaders(response.headers, maskHeaders);
      }
      if (opts.captureResponseBody === true && response.data != null) {
        entry.responseBody = response.data;
      }
    }

    try {
      const profile = this.cls.get<Profile | undefined>('profiler.profile');
      if (profile) {
        appendCollectorEntry<HttpRequestEntry>(profile, AXIOS_REQUESTS_KEY, entry);
      }
    } catch {
      // Outside CLS context
    }
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

// Exported for unit testing. Not re-exported from the package entrypoint
// (index.ts), so these remain internal to the package's public API.
export function extractHeaders(headers: unknown, maskHeaders: string[]): Record<string, string> {
  if (!headers || typeof headers !== 'object') return {};

  const raw: Record<string, unknown> =
    typeof (headers as { toJSON?: () => Record<string, unknown> }).toJSON === 'function'
      ? (headers as { toJSON: () => Record<string, unknown> }).toJSON()
      : (headers as Record<string, unknown>);

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('_') || value == null || typeof value === 'function') continue;
    const strValue = formatHeaderValue(value);
    result[key] = maskHeaders.includes(key.toLowerCase()) ? '[REDACTED]' : strValue;
  }
  return result;
}

export function formatHeaderValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => formatHeaderValue(item)).join(', ');
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'symbol') {
    return value.description ?? value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[Unserializable object]';
    }
  }

  return '[Unknown value]';
}
