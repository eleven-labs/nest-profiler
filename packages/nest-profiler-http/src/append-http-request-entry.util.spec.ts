import type { ClsService } from 'nestjs-cls';
import type { Profile } from '@eleven-labs/nest-profiler';
import { appendHttpRequestEntry } from './append-http-request-entry.util';
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

function makeCls(params: { profile?: Profile | null; throws?: boolean }): ClsService {
  return {
    get: jest.fn(() => {
      if (params.throws) throw new Error('outside CLS');
      return params.profile ?? undefined;
    }),
  } as unknown as ClsService;
}

describe('appendHttpRequestEntry', () => {
  it('appends the entry under the accumulation key when a profile is active', () => {
    const profile = makeProfile();
    const entry = makeRequest();
    appendHttpRequestEntry(makeCls({ profile }), entry);
    expect(profile.collectors[HTTP_CLIENT_REQUESTS_KEY]).toEqual([entry]);
  });

  it('appends multiple entries to the same list', () => {
    const profile = makeProfile();
    const cls = makeCls({ profile });
    appendHttpRequestEntry(cls, makeRequest({ url: '/a' }));
    appendHttpRequestEntry(cls, makeRequest({ url: '/b' }));
    const list = profile.collectors[HTTP_CLIENT_REQUESTS_KEY] as HttpRequestEntry[];
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.url)).toEqual(['/a', '/b']);
  });

  it('is a no-op when no profile is active in CLS', () => {
    expect(() => appendHttpRequestEntry(makeCls({ profile: null }), makeRequest())).not.toThrow();
  });

  it('is a no-op when called outside a CLS context', () => {
    expect(() => appendHttpRequestEntry(makeCls({ throws: true }), makeRequest())).not.toThrow();
  });
});
