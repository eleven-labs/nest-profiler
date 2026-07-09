import axios from 'axios';
import type { ModuleRef, DiscoveryService } from '@nestjs/core';
import type { AxiosAdapter, AxiosResponse } from 'axios';
import type { ClsService } from 'nestjs-cls';
import type { HttpCaptureOptions, HttpRequestEntry } from '../http-request.interface';
import type { Profile } from '@eleven-labs/nest-profiler';
import { HTTP_CLIENT_REQUESTS_KEY } from '../http-request.interface';
import { HttpProfilerRecorder } from '../http-profiler-recorder.service';
import { AxiosInstrumentation } from './axios.instrumentation';

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

function recorderModuleRef(cls: unknown): ModuleRef {
  return { get: () => cls } as unknown as ModuleRef;
}

/** A DiscoveryService stub whose `getProviders()` returns the given instances as wrappers. */
function fakeDiscovery(instances: unknown[]): DiscoveryService {
  return {
    getProviders: () => instances.map((instance) => ({ instance })),
  } as unknown as DiscoveryService;
}

function entriesOf(profile: Profile | null): HttpRequestEntry[] {
  return (profile?.collectors[HTTP_CLIENT_REQUESTS_KEY] as HttpRequestEntry[] | undefined) ?? [];
}

function firstEntry(profile: Profile | null): HttpRequestEntry {
  const first = entriesOf(profile)[0];
  if (first === undefined) throw new Error('expected at least one collected request');
  return first;
}

interface SetupParams {
  adapter?: AxiosAdapter;
  profile?: Profile | null;
  clsThrows?: boolean;
  /** What DiscoveryService.getProviders() surfaces. Defaults to the bare axios instance itself. */
  providers?: (ax: ReturnType<typeof axios.create>) => unknown[];
}

function setup(
  options: HttpCaptureOptions = {},
  params: SetupParams = {},
): {
  ax: ReturnType<typeof axios.create>;
  profile: Profile | null;
  recorder: HttpProfilerRecorder;
} {
  const ax = axios.create();
  ax.defaults.adapter = params.adapter ?? okAdapter();

  const profile = params.profile === undefined ? makeProfile() : params.profile;
  const cls = {
    get: jest.fn(() => {
      if (params.clsThrows) throw new Error('outside CLS');
      return profile ?? undefined;
    }),
  } as unknown as ClsService;

  const recorder = new HttpProfilerRecorder(recorderModuleRef(cls), options);
  const providers = params.providers ? params.providers(ax) : [ax];
  new AxiosInstrumentation(fakeDiscovery(providers)).install(recorder);
  return { ax, profile, recorder };
}

describe('AxiosInstrumentation — auto-discovery', () => {
  it('does nothing when no axios provider is discovered', async () => {
    const { ax, profile } = setup({}, { providers: () => [] });
    await ax.get('https://api.example.com/data');
    expect(entriesOf(profile)).toHaveLength(0);
  });

  it('instruments a discovered bare axios instance', async () => {
    const { ax, profile } = setup();
    await ax.get('https://api.example.com/data');
    expect(entriesOf(profile)).toHaveLength(1);
  });

  it('instruments an HttpService-like provider (duck-typed via axiosRef)', async () => {
    const { ax, profile } = setup({}, { providers: (ax) => [{ axiosRef: ax }] });
    await ax.get('https://api.example.com/data');
    expect(firstEntry(profile).url).toBe('https://api.example.com/data');
  });

  it('discovers and patches several distinct axios instances (the multi-HttpModule case)', async () => {
    const profile = makeProfile();
    const cls = { get: jest.fn(() => profile) } as unknown as ClsService;
    const a = axios.create();
    const b = axios.create();
    a.defaults.adapter = okAdapter();
    b.defaults.adapter = okAdapter();
    const recorder = new HttpProfilerRecorder(recorderModuleRef(cls), {});
    new AxiosInstrumentation(fakeDiscovery([{ axiosRef: a }, { axiosRef: b }])).install(recorder);

    await a.get('https://api.example.com/a');
    await b.get('https://api.example.com/b');
    expect(entriesOf(profile).map((e) => e.url)).toEqual(
      expect.arrayContaining(['https://api.example.com/a', 'https://api.example.com/b']),
    );
  });

  it('ignores non-axios providers (and null) without throwing', async () => {
    const { ax, profile } = setup(
      {},
      { providers: (ax) => [null, {}, { some: 'service' }, 'string', ax] },
    );
    await ax.get('https://api.example.com/data');
    expect(entriesOf(profile)).toHaveLength(1);
  });

  it('tolerates a provider whose axiosRef getter throws', async () => {
    const hostile = Object.defineProperty({}, 'axiosRef', {
      get() {
        throw new Error('nope');
      },
      enumerable: true,
    });
    const { ax, profile } = setup({}, { providers: (ax) => [hostile, ax] });
    await ax.get('https://api.example.com/data');
    expect(entriesOf(profile)).toHaveLength(1);
  });

  it('tolerates a proxy provider that throws on any property access (e.g. nestjs-cls CLS_REQ)', async () => {
    // nestjs-cls proxy providers throw ProxyProviderNotResolvedException on ANY access outside a
    // request — including the `interceptors` read — so the whole duck-typing must be guarded.
    const proxy = new Proxy(
      {},
      {
        get() {
          throw new Error('Cannot access the Proxy provider CLS_REQ outside a request');
        },
      },
    );
    const { ax, profile } = setup({}, { providers: (ax) => [proxy, ax] });
    await ax.get('https://api.example.com/data');
    expect(entriesOf(profile)).toHaveLength(1);
  });

  it('patches a shared instance only once even if discovered under several wrappers', async () => {
    const { ax, profile } = setup({}, { providers: (ax) => [{ axiosRef: ax }, ax] });
    await ax.get('https://api.example.com/data');
    expect(entriesOf(profile)).toHaveLength(1);
  });

  describe('successful requests', () => {
    it('captures method, url, status, headers and request body (POST)', async () => {
      const { ax, profile } = setup(
        { captureRequestBody: true },
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
      const { ax, profile } = setup();
      await ax.get('https://api.example.com/data');
      expect(firstEntry(profile).requestBody).toBeUndefined();
    });

    it('captures the response body when captureResponseBody is enabled', async () => {
      const { ax, profile } = setup(
        { captureResponseBody: true },
        { adapter: okAdapter({}, { result: 42 }) },
      );
      await ax.get('https://api.example.com/data');
      expect(firstEntry(profile).responseBody).toEqual({ result: 42 });
    });

    it('omits captured data when all capture options are disabled', async () => {
      const { ax, profile } = setup(
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
      const { ax, profile } = setup();
      await ax.request({ method: 'GET', baseURL: 'https://api.example.com', url: '/data' });
      expect(firstEntry(profile).url).toBe('https://api.example.com/data');
    });
  });

  describe('error responses', () => {
    it('records the status and error message when a request fails with a response', async () => {
      const { ax, profile } = setup({}, { adapter: errAdapter({ status: 500 }) });
      await expect(ax.get('https://api.example.com/data')).rejects.toThrow('boom');
      const e = firstEntry(profile);
      expect(e.statusCode).toBe(500);
      expect(e.error).toBe('boom');
    });

    it('falls back to defaults when the error carries no config or response', async () => {
      const { ax, profile } = setup({}, { adapter: errAdapter({ withConfig: false }) });
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
    const { ax, profile } = setup({}, { clsThrows: true });
    await expect(ax.get('https://api.example.com/data')).resolves.toBeDefined();
    expect(entriesOf(profile)).toHaveLength(0);
  });

  it('does not append when there is no active profile in CLS', async () => {
    const { ax, profile } = setup({}, { profile: null });
    await ax.get('https://api.example.com/data');
    expect(profile).toBeNull();
  });

  it('does not register interceptors twice when installed again on the same instance', async () => {
    const profile = makeProfile();
    const cls = { get: jest.fn(() => profile) } as unknown as ClsService;
    const ax = axios.create();
    ax.defaults.adapter = okAdapter();
    const recorder = new HttpProfilerRecorder(recorderModuleRef(cls), {});

    const instrumentation = new AxiosInstrumentation(fakeDiscovery([ax]));
    instrumentation.install(recorder);
    instrumentation.install(recorder); // second install must be a no-op (idempotency guard)

    await ax.get('https://api.example.com/data');
    expect(entriesOf(profile)).toHaveLength(1);
  });
});
