import type { ClsService } from 'nestjs-cls';
import type { ModuleRef as _MR } from '@nestjs/core';
import type { Profile } from '@eleven-labs/nest-profiler';
import { HttpProfilerRecorder } from './http-profiler-recorder.service';
import { HTTP_CLIENT_REQUESTS_KEY } from './http-request.interface';
import type { HttpRequestEntry } from './http-request.interface';
import { DEFAULT_MASK_HEADERS } from './http-redaction.util';

function makeProfile(): Profile {
  return {
    token: 'test',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

const entry: HttpRequestEntry = {
  method: 'GET',
  url: 'https://api.example.com/data',
  statusCode: 200,
  duration: 12,
  startedAt: Date.now(),
};

function recorderModuleRef(cls: unknown): _MR {
  return { get: () => cls } as unknown as _MR;
}

describe('HttpProfilerRecorder', () => {
  it('records an entry into the active profile', () => {
    const profile = makeProfile();
    const cls = { get: jest.fn(() => profile) } as unknown as ClsService;
    const recorder = new HttpProfilerRecorder(recorderModuleRef(cls), {});
    recorder.record(entry);
    expect(profile.collectors[HTTP_CLIENT_REQUESTS_KEY]).toEqual([entry]);
  });

  it('merges configured maskHeaders with the built-in defaults', () => {
    const cls = { get: jest.fn() } as unknown as ClsService;
    const recorder = new HttpProfilerRecorder(recorderModuleRef(cls), {
      maskHeaders: ['x-secret'],
    });
    expect(recorder.maskHeaders).toEqual([...DEFAULT_MASK_HEADERS, 'x-secret']);
  });

  it('exposes the configured capture options', () => {
    const cls = { get: jest.fn() } as unknown as ClsService;
    const recorder = new HttpProfilerRecorder(recorderModuleRef(cls), {
      captureResponseBody: true,
    });
    expect(recorder.options.captureResponseBody).toBe(true);
  });

  describe('capture', () => {
    function recordedEntry(profile: Profile): HttpRequestEntry {
      const list = (profile.collectors[HTTP_CLIENT_REQUESTS_KEY] ?? []) as HttpRequestEntry[];
      const first = list[0];
      if (first === undefined) throw new Error('expected a recorded entry');
      return first;
    }

    it('extracts and masks request/response headers and includes bodies per options', () => {
      const profile = makeProfile();
      const cls = { get: jest.fn(() => profile) } as unknown as ClsService;
      const recorder = new HttpProfilerRecorder(recorderModuleRef(cls), {
        captureRequestBody: true,
        captureResponseBody: true,
      });

      recorder.capture({
        method: 'post',
        url: 'https://api.example.com/users',
        startedAt: 1,
        duration: 5,
        statusCode: 201,
        requestHeaders: { authorization: 'Bearer s', 'x-custom': '1' },
        requestBody: { name: 'alice' },
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: { id: 1 },
      });

      const e = recordedEntry(profile);
      expect(e.method).toBe('POST');
      expect(e.requestHeaders).toEqual({ authorization: '[REDACTED]', 'x-custom': '1' });
      expect(e.requestBody).toEqual({ name: 'alice' });
      expect(e.responseHeaders).toEqual({ 'content-type': 'application/json' });
      expect(e.responseBody).toEqual({ id: 1 });
    });

    it('honours disabled capture flags and the GET/HEAD request-body guard', () => {
      const profile = makeProfile();
      const cls = { get: jest.fn(() => profile) } as unknown as ClsService;
      const recorder = new HttpProfilerRecorder(recorderModuleRef(cls), {
        captureResponseHeaders: false,
        // captureResponseBody defaults to false
      });

      recorder.capture({
        method: 'GET',
        url: 'https://api.example.com/data',
        startedAt: 1,
        duration: 3,
        statusCode: 200,
        requestBody: { ignored: true },
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: { big: 'payload' },
      });

      const e = recordedEntry(profile);
      expect(e.requestBody).toBeUndefined();
      expect(e.responseHeaders).toBeUndefined();
      expect(e.responseBody).toBeUndefined();
    });

    it('does not capture the request body by default (captureRequestBody defaults to false)', () => {
      const profile = makeProfile();
      const cls = { get: jest.fn(() => profile) } as unknown as ClsService;
      const recorder = new HttpProfilerRecorder(recorderModuleRef(cls), {});

      recorder.capture({
        method: 'POST',
        url: 'https://api.example.com/users',
        startedAt: 1,
        duration: 2,
        statusCode: 201,
        requestBody: { name: 'alice' },
      });

      expect(recordedEntry(profile).requestBody).toBeUndefined();
    });

    it('redacts credentials in captured request/response bodies', () => {
      const profile = makeProfile();
      const cls = { get: jest.fn(() => profile) } as unknown as ClsService;
      const recorder = new HttpProfilerRecorder(recorderModuleRef(cls), {
        captureRequestBody: true,
        captureResponseBody: true,
      });

      recorder.capture({
        method: 'POST',
        url: 'https://api.example.com/login',
        startedAt: 1,
        duration: 2,
        statusCode: 200,
        requestBody: { username: 'bob', password: 'hunter2' },
        responseBody: { endpoint: 'postgres://user:pass@db/app' },
      });

      const e = recordedEntry(profile);
      expect((e.requestBody as Record<string, unknown>)['password']).toBe('[REDACTED]');
      // Non-sensitive key, but the value carries DSN credentials → userinfo masked.
      expect((e.responseBody as Record<string, unknown>)['endpoint']).toBe(
        'postgres://[REDACTED]@db/app',
      );
    });

    it('captures fetch Headers via record from a custom client', () => {
      const profile = makeProfile();
      const cls = { get: jest.fn(() => profile) } as unknown as ClsService;
      const recorder = new HttpProfilerRecorder(recorderModuleRef(cls), {});

      const responseHeaders = new Headers({ 'content-type': 'text/plain', 'set-cookie': 'a=1' });
      recorder.capture({
        method: 'GET',
        url: 'https://api.example.com/ping',
        startedAt: 1,
        duration: 2,
        statusCode: 200,
        responseHeaders,
      });

      const e = recordedEntry(profile);
      expect(e.responseHeaders?.['content-type']).toBe('text/plain');
      expect(e.responseHeaders?.['set-cookie']).toBe('[REDACTED]');
    });
  });
});
