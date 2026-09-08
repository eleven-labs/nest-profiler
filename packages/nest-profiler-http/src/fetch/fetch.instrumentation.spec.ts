import type { ModuleRef } from '@nestjs/core';
import type { ClsService } from 'nestjs-cls';
import type { HttpCaptureOptions, HttpRequestEntry } from '../http-request.interface';
import type { Profile } from '@eleven-labs/nest-profiler';
import { HTTP_CLIENT_REQUESTS_KEY } from '../http-request.interface';
import { HttpProfilerRecorder } from '../http-profiler-recorder.service';
import { FetchInstrumentation } from './fetch.instrumentation';
import {
  activePhaseSlot,
  registerPhaseSlotProvider,
  resetPhaseSlotProviders,
} from '../phases/phase-slot';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    token: 'test',
    traceId: 'trace-test',
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
  /** Trace id the CLS store reports, for the propagation tests. */
  traceId?: string;
}

/** Installs the instrumentation over a stub `globalThis.fetch`, returning the active profile. */
function setup(
  options: HttpCaptureOptions = {},
  params: SetupParams = {},
): { profile: Profile | null } {
  const profile = params.profile === undefined ? makeProfile() : params.profile;
  const cls = {
    get: jest.fn((key: string) => {
      if (params.clsThrows) throw new Error('outside CLS');
      if (key === 'profiler.traceId') return params.traceId;
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

describe('FetchInstrumentation — trace id propagation', () => {
  /** Records the `init` each call was made with, which is what actually leaves the process. */
  function capturing(): { seen: RequestInit[]; impl: typeof fetch } {
    const seen: RequestInit[] = [];
    const impl: typeof fetch = (_input, init) => {
      seen.push(init ?? {});
      return Promise.resolve(new Response('{}', { status: 200 }));
    };
    return { seen, impl };
  }

  const header = (init: RequestInit | undefined, name: string): string | null =>
    new Headers(init?.headers ?? {}).get(name);

  it('adds nothing when propagation is off, which is the default', async () => {
    const { seen, impl } = capturing();
    setup({}, { impl, traceId: 'trace-1' });

    await fetch('https://api.example.com/x');

    expect(header(seen[0], 'x-request-id')).toBeNull();
  });

  it('forwards the trace id when asked', async () => {
    const { seen, impl } = capturing();
    setup({ propagateTraceId: true }, { impl, traceId: 'trace-1' });

    await fetch('https://api.example.com/x');

    expect(header(seen[0], 'x-request-id')).toBe('trace-1');
  });

  it('leaves a header the caller set explicitly alone', async () => {
    const { seen, impl } = capturing();
    setup({ propagateTraceId: true }, { impl, traceId: 'trace-1' });

    await fetch('https://api.example.com/x', { headers: { 'x-request-id': 'caller-wins' } });

    expect(header(seen[0], 'x-request-id')).toBe('caller-wins');
  });

  it('does not mutate the caller init, so a reused one cannot accumulate a stale header', async () => {
    // A client that keeps one `init` object across calls would otherwise carry the first
    // request's trace id into every later one.
    const { seen, impl } = capturing();
    setup({ propagateTraceId: true }, { impl, traceId: 'trace-1' });
    const shared: RequestInit = { method: 'POST' };

    await fetch('https://api.example.com/x', shared);

    expect(header(seen[0], 'x-request-id')).toBe('trace-1');
    expect(shared.headers).toBeUndefined();
  });

  it('adds nothing outside a profiled request', async () => {
    const { seen, impl } = capturing();
    setup({ propagateTraceId: true }, { impl, profile: null, traceId: undefined });

    await fetch('https://api.example.com/x');

    expect(header(seen[0], 'x-request-id')).toBeNull();
  });
});

describe('FetchInstrumentation — phases', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetPhaseSlotProviders();
  });

  it('records the breakdown a provider deposits in the slot around the call', async () => {
    registerPhaseSlotProvider();
    const { profile } = setup(
      {},
      {
        impl: () => {
          // What UndiciPhases does from its diagnostics-channel subscribers: it finds this call's
          // slot in the async context the adapter opened, and writes into it.
          const slot = activePhaseSlot();
          if (slot) slot.phases = { connect: 2, firstByte: 30 };
          return Promise.resolve(new Response('{}', { status: 200 }));
        },
      },
    );

    await fetch('https://api.example.com/data');
    expect(firstEntry(profile).phases).toEqual({ connect: 2, firstByte: 30 });
  });

  it('enters no async context while no provider is installed', async () => {
    let slotInsideCall: unknown = 'unset';
    const { profile } = setup(
      {},
      {
        impl: () => {
          slotInsideCall = activePhaseSlot();
          return Promise.resolve(new Response('{}', { status: 200 }));
        },
      },
    );

    await fetch('https://api.example.com/data');
    expect(slotInsideCall).toBeUndefined();
    expect(firstEntry(profile).phases).toBeUndefined();
  });
});
