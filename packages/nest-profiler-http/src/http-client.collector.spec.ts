import * as path from 'path';
import type { Profile } from '@eleven-labs/nest-profiler';
import { HTTP_ICON } from '@eleven-labs/nest-profiler';
import { HttpClientCollector } from './http-client.collector';
import { HTTP_CLIENT_REQUESTS_KEY } from './http-request.interface';
import type { HttpRequestEntry } from './http-request.interface';

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

const errorTag = { id: 'error', label: 'Error', severity: 'danger' as const };

describe('HttpClientCollector', () => {
  let collector: HttpClientCollector;

  beforeEach(() => {
    collector = new HttpClientCollector();
  });

  it('carries the core HTTP glyph, the one the HTTP views use', () => {
    // The globe is defined once in the core, so this panel, the HTTP list section and the
    // HTTP routing table cannot drift into three different globes.
    expect(collector.icon).toBe(HTTP_ICON);
  });

  it('collects requests, stamps a fingerprint and removes the internal key', () => {
    const r = makeRequest();
    const profile = makeProfile({ collectors: { [HTTP_CLIENT_REQUESTS_KEY]: [r] } });
    const result = collector.collect(profile);
    expect(result).toEqual([{ ...r, fingerprint: 'GET api.example.com/data' }]);
    expect(profile.collectors[HTTP_CLIENT_REQUESTS_KEY]).toBeUndefined();
  });

  it('returns empty array when no requests', () => {
    expect(collector.collect(makeProfile())).toEqual([]);
  });

  it('getBadgeValue returns null when no requests', () => {
    expect(collector.getBadgeValue(makeProfile())).toBeNull();
  });

  it('getBadgeValue shows request count', () => {
    const profile = makeProfile({
      collectors: { [HTTP_CLIENT_REQUESTS_KEY]: [makeRequest(), makeRequest()] },
    });
    expect(collector.getBadgeValue(profile)).toBe('2');
  });

  it('getBadgeValue is a plain request count; getBadgeSeverity reflects the tags', () => {
    const err = makeRequest({ statusCode: 500, tags: [errorTag] });
    const failed = makeRequest({ statusCode: undefined, error: 'boom', tags: [errorTag] });
    const profile = makeProfile({
      collectors: { [HTTP_CLIENT_REQUESTS_KEY]: [makeRequest(), err, failed] },
    });
    expect(collector.getBadgeValue(profile)).toBe('3');
    expect(collector.getBadgeSeverity(profile)).toBe('danger');
  });

  it('getTagConfig exposes the HTTP defaults and configured overrides', () => {
    expect(new HttpClientCollector().getTagConfig()).toMatchObject({
      slowThreshold: 300,
      nPlusOneThreshold: 2,
      chattyThreshold: 10,
      largePayloadThreshold: 1_048_576,
    });
    expect(new HttpClientCollector({ slowThreshold: 750 }).getTagConfig().slowThreshold).toBe(750);
  });

  describe('getTagConfig error classification', () => {
    const judge = (collector: HttpClientCollector, entry: object): boolean =>
      collector.getTagConfig().isErrorEntry!(entry as never);

    it('counts a failed call or a 5xx, sparing a 4xx answer', () => {
      const collector = new HttpClientCollector();
      expect(judge(collector, { duration: 1, error: 'ECONNREFUSED' })).toBe(true);
      expect(judge(collector, { duration: 1, statusCode: 500 })).toBe(true);
      expect(judge(collector, { duration: 1, statusCode: 404 })).toBe(false);
      expect(judge(collector, { duration: 1, statusCode: 200 })).toBe(false);
    });

    it('counts 4xx when the host lowers the threshold', () => {
      const collector = new HttpClientCollector({ error: { httpStatus: 400 } });
      expect(judge(collector, { duration: 1, statusCode: 404 })).toBe(true);
      expect(judge(collector, { duration: 1, statusCode: 200 })).toBe(false);
    });

    it('exposes the error severity, defaulting to danger', () => {
      expect(new HttpClientCollector().getTagConfig().errorSeverity).toBe('danger');
      expect(
        new HttpClientCollector({ error: { severity: 'warning' } }).getTagConfig().errorSeverity,
      ).toBe('warning');
    });
  });

  it('getTagConfig passes configured severities through', () => {
    expect(
      new HttpClientCollector({
        slowSeverity: 'danger',
        nPlusOneSeverity: 'warning',
        chattySeverity: 'info',
        largePayloadSeverity: 'danger',
      }).getTagConfig(),
    ).toMatchObject({
      slowSeverity: 'danger',
      nPlusOneSeverity: 'warning',
      chattySeverity: 'info',
      largePayloadSeverity: 'danger',
    });
  });

  it('getBadgeValue reads from profile.collectors[name] after collect() has run', () => {
    const r = makeRequest();
    const profile = makeProfile({ collectors: { [HTTP_CLIENT_REQUESTS_KEY]: [r, r] } });
    const collected = collector.collect(profile);
    profile.collectors[collector.name] = collected;
    expect(profile.collectors[HTTP_CLIENT_REQUESTS_KEY]).toBeUndefined();
    expect(collector.getBadgeValue(profile)).toBe('2');
  });

  describe('getTraceSpans', () => {
    it('projects each call onto the trace, linking the bar back to its panel row', () => {
      const profile = makeProfile({
        collectors: {
          'http-client': [
            makeRequest({ url: 'https://api.example.com/a', startedAt: 1000, duration: 20 }),
            makeRequest({ url: 'https://api.example.com/b', startedAt: 1030, duration: 5 }),
          ],
        },
      });

      expect(collector.getTraceSpans(profile)).toEqual([
        {
          kind: 'http',
          label: 'GET https://api.example.com/a',
          startedAt: 1000,
          duration: 20,
          parentId: undefined,
          meta: { status: 200 },
          source: { collector: 'http-client', index: 0, tab: 'http-client' },
        },
        {
          kind: 'http',
          label: 'GET https://api.example.com/b',
          startedAt: 1030,
          duration: 5,
          parentId: undefined,
          meta: { status: 200 },
          source: { collector: 'http-client', index: 1, tab: 'http-client' },
        },
      ]);
    });

    it('carries the parent stamped at capture, which nests the call under its caller', () => {
      const profile = makeProfile({
        collectors: { 'http-client': [makeRequest({ parentSpanId: 's7' })] },
      });

      expect(collector.getTraceSpans(profile)[0]?.parentId).toBe('s7');
    });

    it('reds a bar using this module error option, not a generic status rule', () => {
      // A 404 is an answer for some applications and a failure for others; the option already
      // decides, and the trace must not second-guess it.
      const strict = new HttpClientCollector({ error: { httpStatus: 400 } });
      const profile = makeProfile({
        collectors: { 'http-client': [makeRequest({ statusCode: 404 })] },
      });

      expect(strict.getTraceSpans(profile)[0]?.status).toBe('error');
      expect(collector.getTraceSpans(profile)[0]?.status).toBeUndefined();
    });

    it('surfaces the tags the rule engine applied, so the bar names the problem', () => {
      const profile = makeProfile({
        collectors: { 'http-client': [makeRequest({ tags: [errorTag] })] },
      });

      expect(collector.getTraceSpans(profile)[0]?.tags).toEqual([errorTag]);
    });

    it('contributes nothing when no call was captured', () => {
      expect(collector.getTraceSpans(makeProfile())).toEqual([]);
    });
  });

  it('getTemplatePath returns an absolute path ending with http-client-panel.ejs', () => {
    const p = collector.getTemplatePath();
    expect(p).toMatch(/http-client-panel\.ejs$/);
    expect(path.isAbsolute(p)).toBe(true);
  });
});
