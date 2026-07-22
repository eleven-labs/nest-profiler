import { Injectable } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { nowMs, sinceMs } from '@eleven-labs/nest-profiler';
import type { HttpInstrumentation } from '../http-instrumentation.interface';
import type { HttpProfilerRecorder } from '../http-profiler-recorder.service';

interface ProfilerAxiosConfig extends InternalAxiosRequestConfig {
  _profilerStart?: number;
  _profilerRequestBody?: unknown;
}

type PatchableAxios = AxiosInstance & { __profilerPatched?: boolean };

/**
 * Built-in {@link HttpInstrumentation} for axios. It **auto-discovers** every axios instance in
 * the DI container — `@nestjs/axios` `HttpService` (each per-feature `HttpModule` / `HttpModule.register()`
 * builds a distinct instance) as well as any bare axios instance provided directly — and patches
 * each one's interceptors to record requests on the active profile via {@link HttpProfilerRecorder}.
 *
 * This package intentionally has **no dependency on `@nestjs/axios`** nor a runtime `require` of
 * `axios`: instances are found by duck-typing DI providers (an object exposing an `axiosRef`, or an
 * axios instance itself), and only axios's *types* are referenced (type-only imports, erased at
 * build). If axios isn't used anywhere, discovery finds nothing and this adapter is a no-op.
 *
 * Instances created outside DI (e.g. a bare `axios.create()` held in a private field, or a
 * third-party library's internal client) are not discoverable — record those with a small custom
 * {@link HttpInstrumentation} or via the exported {@link HttpProfilerRecorder}.
 */
@Injectable()
export class AxiosInstrumentation implements HttpInstrumentation {
  /** Instances we already patched, to stay idempotent across duplicate wrappers / re-installs. */
  private readonly patched = new WeakSet<PatchableAxios>();

  constructor(private readonly discovery: DiscoveryService) {}

  install(recorder: HttpProfilerRecorder): void {
    for (const wrapper of this.discovery.getProviders()) {
      const ref = asAxiosInstance(wrapper.instance);
      if (ref) this.patch(ref, recorder);
    }
  }

  private patch(axiosRef: PatchableAxios, recorder: HttpProfilerRecorder): void {
    // Already patched (idempotent across re-inits / shared instances / duplicate wrappers).
    if (this.patched.has(axiosRef) || axiosRef.__profilerPatched) return;
    this.patched.add(axiosRef);
    axiosRef.__profilerPatched = true;

    axiosRef.interceptors.request.use((config: ProfilerAxiosConfig) => {
      config._profilerStart = nowMs();
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
      startedAt: config._profilerStart ?? nowMs(),
      duration: config._profilerStart ? sinceMs(config._profilerStart) : 0,
      statusCode: response?.status,
      error,
      requestHeaders: config.headers,
      requestBody: config._profilerRequestBody,
      responseHeaders: response?.headers,
      responseBody: response?.data,
    });
  }
}

/**
 * Duck-types a DI provider instance to the axios instance it exposes, or `undefined` if it is not
 * axios-like. Accepts either an `HttpService`-style object (an `axiosRef` property) or an axios
 * instance directly.
 *
 * All property access is wrapped in a single try/catch: `getProviders()` also surfaces foreign
 * providers whose getters throw — notably nestjs-cls proxy providers (`CLS_REQ`/`CLS_RES`), which
 * throw `ProxyProviderNotResolvedException` on any access outside a request context (i.e. at
 * bootstrap, exactly when we run). Any throw means "not an axios instance", so we skip it.
 */
function asAxiosInstance(instance: unknown): PatchableAxios | undefined {
  if (instance == null || (typeof instance !== 'object' && typeof instance !== 'function')) {
    return undefined;
  }

  try {
    const axiosRef = (instance as { axiosRef?: unknown }).axiosRef;
    const ref = axiosRef ?? instance;
    const candidate = ref as {
      interceptors?: { request?: { use?: unknown }; response?: { use?: unknown } };
    };
    if (
      typeof candidate?.interceptors?.request?.use === 'function' &&
      typeof candidate?.interceptors?.response?.use === 'function'
    ) {
      return ref as PatchableAxios;
    }
  } catch {
    // A foreign/proxy provider threw on access (e.g. nestjs-cls CLS_REQ) — not axios, skip.
  }
  return undefined;
}

function resolveRequestUrl(config: Partial<ProfilerAxiosConfig>): string {
  const baseUrl = typeof config.baseURL === 'string' ? config.baseURL : '';
  const rawUrl = typeof config.url === 'string' ? config.url : '?';
  if (baseUrl && rawUrl !== '?' && !rawUrl.startsWith('http')) {
    return baseUrl + rawUrl;
  }
  return rawUrl;
}
