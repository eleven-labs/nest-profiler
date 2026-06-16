import * as path from 'path';
import type { Profile } from '@eleven-labs/nest-profiler';
import { HttpClientCollector } from './http-client.collector';
import { HTTP_CLIENT_REQUESTS_KEY } from './http-request.interface';
import type { HttpRequestEntry } from './http-request.interface';

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

describe('HttpClientCollector', () => {
  let collector: HttpClientCollector;

  beforeEach(() => {
    collector = new HttpClientCollector();
  });

  it('collects requests and removes the internal key', () => {
    const r = makeRequest();
    const profile = makeProfile({ collectors: { [HTTP_CLIENT_REQUESTS_KEY]: [r] } });
    const result = collector.collect(profile);
    expect(result).toEqual([r]);
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

  it('getBadgeValue includes error count for failed and 4xx/5xx requests', () => {
    const err = makeRequest({ statusCode: 500 });
    const failed = makeRequest({ statusCode: undefined, error: 'boom' });
    const profile = makeProfile({
      collectors: { [HTTP_CLIENT_REQUESTS_KEY]: [makeRequest(), err, failed] },
    });
    expect(collector.getBadgeValue(profile)).toBe('3 (2 err)');
  });

  it('getBadgeValue reads from profile.collectors[name] after collect() has run', () => {
    const r = makeRequest();
    const profile = makeProfile({ collectors: { [HTTP_CLIENT_REQUESTS_KEY]: [r, r] } });
    const collected = collector.collect(profile);
    profile.collectors[collector.name] = collected;
    expect(profile.collectors[HTTP_CLIENT_REQUESTS_KEY]).toBeUndefined();
    expect(collector.getBadgeValue(profile)).toBe('2');
  });

  it('getTemplatePath returns an absolute path ending with http-client-panel.ejs', () => {
    const p = collector.getTemplatePath();
    expect(p).toMatch(/http-client-panel\.ejs$/);
    expect(path.isAbsolute(p)).toBe(true);
  });
});
