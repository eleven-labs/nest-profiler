import * as path from 'path';
import axios from 'axios';
import type { AxiosAdapter, AxiosResponse } from 'axios';
import type { ModuleRef } from '@nestjs/core';
import type { HttpService } from '@nestjs/axios';
import type { ClsService } from 'nestjs-cls';
import { AxiosCollector } from './axios.collector';
import { AxiosCollectorModule } from './axios-collector.module';
import {
  AxiosInterceptorPatch,
  extractHeaders,
  formatHeaderValue,
} from './axios-interceptor.patch';
import { AXIOS_REQUESTS_KEY } from './axios-collector.interface';
import type { Profile } from '@eleven-labs/nest-profiler';
import type { HttpRequestEntry } from './axios-collector.interface';
import type { AxiosCollectorModuleOptions } from './axios-collector.module';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    token: 'test',
    createdAt: Date.now(),
    request: { method: 'GET', url: '/', headers: {}, query: {} },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
    ...overrides,
  };
}

function makeRequest(overrides: Partial<HttpRequestEntry> = {}): HttpRequestEntry {
  return {
    method: 'GET',
    url: 'https://api.example.com/data',
    statusCode: 200,
    duration: 50,
    startedAt: Date.now(),
    ...overrides,
  };
}

describe('AxiosCollector', () => {
  let collector: AxiosCollector;

  beforeEach(() => {
    collector = new AxiosCollector();
  });

  it('collects requests and removes the internal key', () => {
    const r = makeRequest();
    const profile = makeProfile({ collectors: { [AXIOS_REQUESTS_KEY]: [r] } });
    const result = collector.collect(profile);
    expect(result).toEqual([r]);
    expect(profile.collectors[AXIOS_REQUESTS_KEY]).toBeUndefined();
  });

  it('returns empty array when no requests', () => {
    expect(collector.collect(makeProfile())).toEqual([]);
  });

  it('getBadgeValue returns null when no requests', () => {
    expect(collector.getBadgeValue(makeProfile())).toBeNull();
  });

  it('getBadgeValue shows request count', () => {
    const profile = makeProfile({
      collectors: { [AXIOS_REQUESTS_KEY]: [makeRequest(), makeRequest()] },
    });
    expect(collector.getBadgeValue(profile)).toBe('2');
  });

  it('getBadgeValue includes error count', () => {
    const err = makeRequest({ statusCode: 500 });
    const profile = makeProfile({ collectors: { [AXIOS_REQUESTS_KEY]: [makeRequest(), err] } });
    expect(collector.getBadgeValue(profile)).toBe('2 (1 err)');
  });

  it('getBadgeValue reads from profile.collectors[name] after collect() has run', () => {
    const r = makeRequest();
    const profile = makeProfile({ collectors: { [AXIOS_REQUESTS_KEY]: [r, r] } });
    const collected = collector.collect(profile);
    profile.collectors[collector.name] = collected;
    expect(profile.collectors[AXIOS_REQUESTS_KEY]).toBeUndefined();
    expect(collector.getBadgeValue(profile)).toBe('2');
  });

  it('getTemplatePath returns an absolute path ending with axios-panel.ejs', () => {
    const p = collector.getTemplatePath();
    expect(p).toMatch(/axios-panel\.ejs$/);
    expect(path.isAbsolute(p)).toBe(true);
  });
});

describe('AxiosCollectorModule.forRoot', () => {
  it('returns a no-op module when enabled is false', () => {
    expect(AxiosCollectorModule.forRoot({ enabled: false })).toEqual({
      module: AxiosCollectorModule,
    });
  });

  it('registers providers by default', () => {
    expect(AxiosCollectorModule.forRoot().providers?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('AxiosInterceptorPatch', () => {
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
      const err = new Error('boom') as Error & {
        config?: unknown;
        response?: unknown;
      };
      if (opts.withConfig !== false) err.config = config;
      if (opts.status) {
        err.response = { status: opts.status, statusText: '', headers: {}, data: {}, config };
      }
      return Promise.reject(err);
    };

  async function bootstrap(
    options: AxiosCollectorModuleOptions,
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
        params.resolveThrows
          ? Promise.reject(new Error('unresolved'))
          : Promise.resolve(httpService),
      ),
    } as unknown as ModuleRef;

    const profile = params.profile === undefined ? makeProfile() : params.profile;
    const cls = {
      get: jest.fn(() => {
        if (params.clsThrows) throw new Error('outside CLS');
        return profile ?? undefined;
      }),
    } as unknown as ClsService;

    const patch = new AxiosInterceptorPatch(cls, moduleRef, options);
    await patch.onApplicationBootstrap();
    return { ax, profile };
  }

  function entriesOf(profile: Profile | null): HttpRequestEntry[] {
    return (profile?.collectors[AXIOS_REQUESTS_KEY] as HttpRequestEntry[] | undefined) ?? [];
  }

  describe('bootstrap guards', () => {
    it('does nothing when HttpService cannot be resolved', async () => {
      const { ax, profile } = await bootstrap({}, { resolveThrows: true, adapter: okAdapter() });
      await ax.get('https://api.example.com/data');
      expect(entriesOf(profile)).toHaveLength(0);
    });

    it('does nothing when the resolved service has no axiosRef', async () => {
      await expect(bootstrap({}, { noAxiosRef: true })).resolves.toBeDefined();
    });
  });

  describe('successful requests', () => {
    it('captures method, url, status, headers and request body (POST)', async () => {
      const { ax, profile } = await bootstrap(
        {},
        { adapter: okAdapter({ 'content-type': 'application/json' }) },
      );
      await ax.post(
        'https://api.example.com/users',
        { name: 'alice' },
        { headers: { authorization: 'Bearer secret', 'x-custom': '1' } },
      );

      const [e] = entriesOf(profile);
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
      const { ax, profile } = await bootstrap({}, { adapter: okAdapter() });
      await ax.get('https://api.example.com/data');
      expect(entriesOf(profile)[0].requestBody).toBeUndefined();
    });

    it('captures the response body when captureResponseBody is enabled', async () => {
      const { ax, profile } = await bootstrap(
        { captureResponseBody: true },
        { adapter: okAdapter({}, { result: 42 }) },
      );
      await ax.get('https://api.example.com/data');
      expect(entriesOf(profile)[0].responseBody).toEqual({ result: 42 });
    });

    it('omits captured data when all capture options are disabled', async () => {
      const { ax, profile } = await bootstrap(
        {
          captureRequestHeaders: false,
          captureRequestBody: false,
          captureResponseHeaders: false,
        },
        { adapter: okAdapter({ 'content-type': 'application/json' }) },
      );
      await ax.post('https://api.example.com/users', { name: 'a' });
      const [e] = entriesOf(profile);
      expect(e.requestHeaders).toBeUndefined();
      expect(e.requestBody).toBeUndefined();
      expect(e.responseHeaders).toBeUndefined();
    });

    it('resolves a relative url against the configured baseURL', async () => {
      const { ax, profile } = await bootstrap({}, { adapter: okAdapter() });
      await ax.request({ method: 'GET', baseURL: 'https://api.example.com', url: '/data' });
      expect(entriesOf(profile)[0].url).toBe('https://api.example.com/data');
    });
  });

  describe('error responses', () => {
    it('records the status and error message when a request fails with a response', async () => {
      const { ax, profile } = await bootstrap({}, { adapter: errAdapter({ status: 500 }) });
      await expect(ax.get('https://api.example.com/data')).rejects.toThrow('boom');
      const [e] = entriesOf(profile);
      expect(e.statusCode).toBe(500);
      expect(e.error).toBe('boom');
    });

    it('falls back to defaults when the error carries no config or response', async () => {
      const { ax, profile } = await bootstrap({}, { adapter: errAdapter({ withConfig: false }) });
      await expect(ax.get('https://api.example.com/data')).rejects.toThrow('boom');
      const [e] = entriesOf(profile);
      expect(e.method).toBe('GET');
      expect(e.url).toBe('?');
      expect(e.statusCode).toBeUndefined();
      expect(e.error).toBe('boom');
      expect(e.duration).toBe(0);
    });
  });

  it('silently ignores requests made outside a CLS context', async () => {
    const { ax, profile } = await bootstrap({}, { adapter: okAdapter(), clsThrows: true });
    await expect(ax.get('https://api.example.com/data')).resolves.toBeDefined();
    expect(entriesOf(profile)).toHaveLength(0);
  });

  it('does not append when there is no active profile in CLS', async () => {
    const { ax, profile } = await bootstrap({}, { adapter: okAdapter(), profile: null });
    await ax.get('https://api.example.com/data');
    expect(profile).toBeNull();
  });
});

describe('extractHeaders', () => {
  it('returns an empty object for non-object input', () => {
    expect(extractHeaders(undefined, [])).toEqual({});
    expect(extractHeaders('nope', [])).toEqual({});
  });

  it('uses toJSON() when the header bag provides one', () => {
    const bag = { toJSON: () => ({ 'x-a': '1' }) };
    expect(extractHeaders(bag, [])).toEqual({ 'x-a': '1' });
  });

  it('skips underscore-prefixed, null and function values', () => {
    const result = extractHeaders(
      { _internal: 'x', 'x-null': null, 'x-fn': () => undefined, 'x-ok': 'yes' },
      [],
    );
    expect(result).toEqual({ 'x-ok': 'yes' });
  });

  it('redacts masked headers case-insensitively', () => {
    expect(extractHeaders({ Authorization: 'Bearer s' }, ['authorization'])).toEqual({
      Authorization: '[REDACTED]',
    });
  });
});

describe('formatHeaderValue', () => {
  it('joins array values', () => {
    expect(formatHeaderValue(['a', 'b'])).toBe('a, b');
  });

  it('stringifies primitives', () => {
    expect(formatHeaderValue('s')).toBe('s');
    expect(formatHeaderValue(5)).toBe('5');
    expect(formatHeaderValue(true)).toBe('true');
  });

  it('stringifies bigint and symbol', () => {
    expect(formatHeaderValue(BigInt(9))).toBe('9');
    expect(formatHeaderValue(Symbol('sym'))).toBe('sym');
  });

  it('renders Date as ISO string', () => {
    expect(formatHeaderValue(new Date('2026-01-02T03:04:05.000Z'))).toBe(
      '2026-01-02T03:04:05.000Z',
    );
  });

  it('JSON-stringifies plain objects', () => {
    expect(formatHeaderValue({ nested: 1 })).toBe('{"nested":1}');
  });

  it('returns a placeholder for unserializable objects', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(formatHeaderValue(circular)).toBe('[Unserializable object]');
  });

  it('returns a placeholder for values of unknown type', () => {
    expect(formatHeaderValue(undefined)).toBe('[Unknown value]');
  });
});
