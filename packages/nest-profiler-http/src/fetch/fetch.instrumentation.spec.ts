import type { ModuleRef } from '@nestjs/core';
import type { ClsService } from 'nestjs-cls';
import type { HttpCaptureOptions, HttpRequestEntry } from '../http-request.interface';
import type { Profile } from '@eleven-labs/nest-profiler';
import { HTTP_CLIENT_REQUESTS_KEY } from '../http-request.interface';
import { HttpProfilerRecorder } from '../http-profiler-recorder.service';
import { FetchInstrumentation } from './fetch.instrumentation';

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

function recorderModuleRef(cls: unknown): ModuleRef {
  return { get: () => cls } as unknown as ModuleRef;
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
  impl?: typeof fetch;
  profile?: Profile | null;
  clsThrows?: boolean;
}

/** Installs the instrumentation over a stub `globalThis.fetch`, returning the active profile. */
function setup(
  options: HttpCaptureOptions = {},
  params: SetupParams = {},
): { profile: Profile | null } {
  const profile = params.profile === undefined ? makeProfile() : params.profile;
  const cls = {
    get: jest.fn(() => {
      if (params.clsThrows) throw new Error('outside CLS');
      return profile ?? undefined;
    }),
  } as unknown as ClsService;

  const okFetch: typeof fetch = () =>
    Promise.resolve(
      new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  globalThis.fetch = params.impl ?? okFetch;

  const recorder = new HttpProfilerRecorder(recorderModuleRef(cls), options);
  new FetchInstrumentation().install(recorder);
  return { profile };
}

describe('FetchInstrumentation', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('captures method, url, status and response headers on a GET', async () => {
    const { profile } = setup();
    const response = await fetch('https://api.example.com/data');

    expect(response.status).toBe(200);
    const e = firstEntry(profile);
    expect(e.method).toBe('GET');
    expect(e.url).toBe('https://api.example.com/data');
    expect(e.statusCode).toBe(200);
    expect(e.duration).toBeGreaterThanOrEqual(0);
    expect(e.responseHeaders?.['content-type']).toBe('application/json');
    expect(e.responseBody).toBeUndefined();
    expect(e.requestBody).toBeUndefined();
  });

  it('captures the response body when captureResponseBody is enabled', async () => {
    const { profile } = setup(
      { captureResponseBody: true },
      { impl: () => Promise.resolve(new Response('{"result":42}', { status: 200 })) },
    );
    await fetch('https://api.example.com/data');
    expect(firstEntry(profile).responseBody).toEqual({ result: 42 });
  });

  it('captures request headers (masked) and a JSON request body on POST', async () => {
    const { profile } = setup({ captureRequestBody: true });
    await fetch('https://api.example.com/users', {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'x-custom': '1' },
      body: JSON.stringify({ name: 'alice' }),
    });

    const e = firstEntry(profile);
    expect(e.method).toBe('POST');
    expect(e.requestHeaders?.['authorization']).toBe('[REDACTED]');
    expect(e.requestHeaders?.['x-custom']).toBe('1');
    expect(e.requestBody).toEqual({ name: 'alice' });
  });

  it('accepts a Request object as the first argument', async () => {
    const { profile } = setup();
    await fetch(
      new Request('https://api.example.com/thing', { method: 'PUT', headers: { 'x-a': '1' } }),
    );
    const e = firstEntry(profile);
    expect(e.method).toBe('PUT');
    expect(e.url).toBe('https://api.example.com/thing');
    expect(e.requestHeaders?.['x-a']).toBe('1');
  });

  it('accepts a URL object as the first argument', async () => {
    const { profile } = setup();
    await fetch(new URL('https://api.example.com/url-obj'));
    expect(firstEntry(profile).url).toBe('https://api.example.com/url-obj');
  });

  it('captures a URLSearchParams request body', async () => {
    const { profile } = setup({ captureRequestBody: true });
    await fetch('https://api.example.com/form', {
      method: 'POST',
      body: new URLSearchParams({ a: '1', b: '2' }),
    });
    expect(firstEntry(profile).requestBody).toEqual({ a: '1', b: '2' });
  });

  it('captures a raw (non-JSON) string request body as-is', async () => {
    const { profile } = setup({ captureRequestBody: true });
    await fetch('https://api.example.com/raw', { method: 'POST', body: 'hello=world' });
    expect(firstEntry(profile).requestBody).toBe('hello=world');
  });

  it('skips a non-serialisable request body (e.g. Blob)', async () => {
    const { profile } = setup({ captureRequestBody: true });
    await fetch('https://api.example.com/upload', { method: 'POST', body: new Blob(['binary']) });
    expect(firstEntry(profile).requestBody).toBeUndefined();
  });

  it('captures a non-JSON response body as text when enabled', async () => {
    const { profile } = setup(
      { captureResponseBody: true },
      { impl: () => Promise.resolve(new Response('plain text', { status: 200 })) },
    );
    await fetch('https://api.example.com/text');
    expect(firstEntry(profile).responseBody).toBe('plain text');
  });

  it('treats an empty response body as no body', async () => {
    const { profile } = setup(
      { captureResponseBody: true },
      { impl: () => Promise.resolve(new Response('', { status: 200 })) },
    );
    await fetch('https://api.example.com/empty');
    expect(firstEntry(profile).responseBody).toBeUndefined();
  });

  it('records an error and rethrows when fetch rejects', async () => {
    const { profile } = setup({}, { impl: () => Promise.reject(new Error('network down')) });
    await expect(fetch('https://api.example.com/data')).rejects.toThrow('network down');
    const e = firstEntry(profile);
    expect(e.error).toBe('network down');
    expect(e.statusCode).toBeUndefined();
  });

  it('patches globalThis.fetch only once across repeated installs', async () => {
    const { profile } = setup();
    const recorder = new HttpProfilerRecorder(recorderModuleRef({ get: () => profile }), {});
    new FetchInstrumentation().install(recorder); // second install must be a no-op

    await fetch('https://api.example.com/data');
    expect(entriesOf(profile)).toHaveLength(1);
  });

  it('does not append when there is no active profile', async () => {
    const { profile } = setup({}, { profile: null });
    await fetch('https://api.example.com/data');
    expect(profile).toBeNull();
  });

  it('is a soft no-op when globalThis.fetch is unavailable', () => {
    const saved = globalThis.fetch;
    // @ts-expect-error — simulate an environment without fetch.
    globalThis.fetch = undefined;
    const recorder = new HttpProfilerRecorder(recorderModuleRef(undefined), {});
    expect(() => new FetchInstrumentation().install(recorder)).not.toThrow();
    expect(globalThis.fetch).toBeUndefined();
    globalThis.fetch = saved;
  });
});
