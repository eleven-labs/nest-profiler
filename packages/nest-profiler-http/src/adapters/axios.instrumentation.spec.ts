import axios from 'axios';
import type { AxiosAdapter, AxiosResponse } from 'axios';
import type { ModuleRef } from '@nestjs/core';
import type { HttpService } from '@nestjs/axios';
import type { ClsService } from 'nestjs-cls';
import type { HttpRequestEntry } from '../http-request.interface';
import type { Profile } from '@eleven-labs/nest-profiler';
import { HTTP_CLIENT_REQUESTS_KEY } from '../http-request.interface';
import { HttpProfilerRecorder } from '../http-profiler-recorder.service';
import { AxiosInstrumentation } from './axios.instrumentation';
import type { HttpCaptureOptions } from '../http-request.interface';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    token: 'test',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
    ...overrides,
  };
}

/** A custom axios adapter that resolves with a controllable response. */
const okAdapter =
  (
    responseHeaders: Record<string, unknown> = {},
    data: unknown = { ok: true },
    status = 200,
  ): AxiosAdapter =>
  (config) =>
    Promise.resolve({
      data,
      status,
      statusText: 'OK',
      headers: responseHeaders,
      config,
    } as unknown as AxiosResponse);

/** A custom adapter that rejects, optionally carrying config/response. */
const errAdapter =
  (opts: { withConfig?: boolean; status?: number } = {}): AxiosAdapter =>
  (config) => {
    const err = new Error('boom') as Error & { config?: unknown; response?: unknown };
    if (opts.withConfig !== false) err.config = config;
    if (opts.status) {
      err.response = { status: opts.status, statusText: '', headers: {}, data: {}, config };
    }
    return Promise.reject(err);
  };

async function install(
  options: HttpCaptureOptions,
  params: {
    adapter?: AxiosAdapter;
    profile?: Profile | null;
    clsThrows?: boolean;
    resolveThrows?: boolean;
    noAxiosRef?: boolean;
  } = {},
): Promise<{ ax: ReturnType<typeof axios.create>; profile: Profile | null }> {
  const ax = axios.create();
  if (params.adapter) ax.defaults.adapter = params.adapter;

  const httpService = (params.noAxiosRef ? {} : { axiosRef: ax }) as unknown as HttpService;
  const moduleRef = {
    resolve: jest.fn(() =>
      params.resolveThrows ? Promise.reject(new Error('unresolved')) : Promise.resolve(httpService),
    ),
  } as unknown as ModuleRef;

  const profile = params.profile === undefined ? makeProfile() : params.profile;
  const cls = {
    get: jest.fn(() => {
      if (params.clsThrows) throw new Error('outside CLS');
      return profile ?? undefined;
    }),
  } as unknown as ClsService;

  const recorder = new HttpProfilerRecorder(cls, options);
  const instrumentation = new AxiosInstrumentation(moduleRef);
  await instrumentation.install(recorder);
  return { ax, profile };
}

function entriesOf(profile: Profile | null): HttpRequestEntry[] {
  return (profile?.collectors[HTTP_CLIENT_REQUESTS_KEY] as HttpRequestEntry[] | undefined) ?? [];
}

function firstEntry(profile: Profile | null): HttpRequestEntry {
  const first = entriesOf(profile)[0];
  if (first === undefined) throw new Error('expected at least one collected request');
  return first;
}

describe('AxiosInstrumentation', () => {
  describe('install guards', () => {
    it('does nothing when HttpService cannot be resolved', async () => {
      const { ax, profile } = await install({}, { resolveThrows: true, adapter: okAdapter() });
      await ax.get('https://api.example.com/data');
      expect(entriesOf(profile)).toHaveLength(0);
    });

    it('does nothing when the resolved service has no axiosRef', async () => {
      await expect(install({}, { noAxiosRef: true })).resolves.toBeDefined();
    });
  });

  describe('successful requests', () => {
    it('captures method, url, status, headers and request body (POST)', async () => {
      const { ax, profile } = await install(
        {},
        { adapter: okAdapter({ 'content-type': 'application/json' }) },
      );
      await ax.post(
        'https://api.example.com/users',
        { name: 'alice' },
        { headers: { authorization: 'Bearer secret', 'x-custom': '1' } },
      );

      const e = firstEntry(profile);
      expect(e.method).toBe('POST');
      expect(e.url).toBe('https://api.example.com/users');
      expect(e.statusCode).toBe(200);
      expect(e.duration).toBeGreaterThanOrEqual(0);
      expect(e.requestBody).toEqual({ name: 'alice' });
      expect(e.requestHeaders?.['authorization']).toBe('[REDACTED]');
      expect(e.requestHeaders?.['x-custom']).toBe('1');
      expect(e.responseHeaders?.['content-type']).toBe('application/json');
      expect(e.responseBody).toBeUndefined();
    });

    it('does not capture a request body for GET requests', async () => {
      const { ax, profile } = await install({}, { adapter: okAdapter() });
      await ax.get('https://api.example.com/data');
      expect(firstEntry(profile).requestBody).toBeUndefined();
    });

    it('captures the response body when captureResponseBody is enabled', async () => {
      const { ax, profile } = await install(
        { captureResponseBody: true },
        { adapter: okAdapter({}, { result: 42 }) },
      );
      await ax.get('https://api.example.com/data');
      expect(firstEntry(profile).responseBody).toEqual({ result: 42 });
    });

    it('omits captured data when all capture options are disabled', async () => {
      const { ax, profile } = await install(
        {
          captureRequestHeaders: false,
          captureRequestBody: false,
          captureResponseHeaders: false,
        },
        { adapter: okAdapter({ 'content-type': 'application/json' }) },
      );
      await ax.post('https://api.example.com/users', { name: 'a' });
      const e = firstEntry(profile);
      expect(e.requestHeaders).toBeUndefined();
      expect(e.requestBody).toBeUndefined();
      expect(e.responseHeaders).toBeUndefined();
    });

    it('resolves a relative url against the configured baseURL', async () => {
      const { ax, profile } = await install({}, { adapter: okAdapter() });
      await ax.request({ method: 'GET', baseURL: 'https://api.example.com', url: '/data' });
      expect(firstEntry(profile).url).toBe('https://api.example.com/data');
    });
  });

  describe('error responses', () => {
    it('records the status and error message when a request fails with a response', async () => {
      const { ax, profile } = await install({}, { adapter: errAdapter({ status: 500 }) });
      await expect(ax.get('https://api.example.com/data')).rejects.toThrow('boom');
      const e = firstEntry(profile);
      expect(e.statusCode).toBe(500);
      expect(e.error).toBe('boom');
    });

    it('falls back to defaults when the error carries no config or response', async () => {
      const { ax, profile } = await install({}, { adapter: errAdapter({ withConfig: false }) });
      await expect(ax.get('https://api.example.com/data')).rejects.toThrow('boom');
      const e = firstEntry(profile);
      expect(e.method).toBe('GET');
      expect(e.url).toBe('?');
      expect(e.statusCode).toBeUndefined();
      expect(e.error).toBe('boom');
      expect(e.duration).toBe(0);
    });
  });

  it('silently ignores requests made outside a CLS context', async () => {
    const { ax, profile } = await install({}, { adapter: okAdapter(), clsThrows: true });
    await expect(ax.get('https://api.example.com/data')).resolves.toBeDefined();
    expect(entriesOf(profile)).toHaveLength(0);
  });

  it('does not append when there is no active profile in CLS', async () => {
    const { ax, profile } = await install({}, { adapter: okAdapter(), profile: null });
    await ax.get('https://api.example.com/data');
    expect(profile).toBeNull();
  });

  it('does not register interceptors twice when installed again on the same axios instance', async () => {
    const ax = axios.create();
    ax.defaults.adapter = okAdapter();
    const httpService = { axiosRef: ax } as unknown as HttpService;
    const moduleRef = {
      resolve: jest.fn(() => Promise.resolve(httpService)),
    } as unknown as ModuleRef;
    const profile = makeProfile();
    const cls = { get: jest.fn(() => profile) } as unknown as ClsService;
    const recorder = new HttpProfilerRecorder(cls, {});

    const instrumentation = new AxiosInstrumentation(moduleRef);
    await instrumentation.install(recorder);
    await instrumentation.install(recorder); // second install must be a no-op (idempotency guard)

    await ax.get('https://api.example.com/data');
    expect(entriesOf(profile)).toHaveLength(1);
  });
});
