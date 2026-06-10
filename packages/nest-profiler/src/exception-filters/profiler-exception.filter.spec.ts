import type { ArgumentsHost } from '@nestjs/common';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { ClsService } from 'nestjs-cls';
import { PROFILER_REQ_KEY } from '../constants';
import type { Profile } from '../interfaces/profile.interface';
import { ProfilerExceptionFilter } from './profiler-exception.filter';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    token: 'tok',
    createdAt: Date.now(),
    request: { method: 'GET', url: '/auth/me', headers: {}, query: {} },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
    ...overrides,
  };
}

function makeHost(type: string, req: Record<string | symbol, unknown> = {}): ArgumentsHost {
  return {
    getType: <T>() => type as unknown as T,
    switchToHttp: () => ({ getRequest: <T>() => req as unknown as T }),
  } as unknown as ArgumentsHost;
}

function makeCls(profile?: Profile): ClsService {
  return {
    get: jest.fn(() => profile),
  } as unknown as ClsService;
}

describe('ProfilerExceptionFilter', () => {
  // Neutralize the base filter so tests never touch a real HTTP adapter.
  let superCatch: jest.SpyInstance;

  beforeEach(() => {
    superCatch = jest
      .spyOn(BaseExceptionFilter.prototype, 'catch')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records a guard exception on the profile when the interceptor never ran', () => {
    const profile = makeProfile();
    const filter = new ProfilerExceptionFilter(makeCls(profile));
    const host = makeHost('http', { [PROFILER_REQ_KEY]: profile });

    filter.catch(new UnauthorizedException('Missing Bearer token'), host);

    expect(profile.exceptions).toHaveLength(1);
    expect(profile.exceptions[0]).toMatchObject({
      name: 'UnauthorizedException',
      message: 'Missing Bearer token',
    });
    expect(profile.exceptions[0]?.stack).toContain('UnauthorizedException');
    // Default response formatting is always delegated to the base filter.
    expect(superCatch).toHaveBeenCalledTimes(1);
  });

  it('does not double-record when the interceptor already finalized the profile', () => {
    // A set `response` is the marker that the interceptor handled (and saved) the request.
    const profile = makeProfile({
      response: { statusCode: 500, headers: {}, body: undefined },
    });
    const filter = new ProfilerExceptionFilter(makeCls(profile));
    const host = makeHost('http', { [PROFILER_REQ_KEY]: profile });

    filter.catch(new HttpException('boom', 500), host);

    expect(profile.exceptions).toHaveLength(0);
    expect(superCatch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the request-bound profile when CLS has none', () => {
    const profile = makeProfile();
    const filter = new ProfilerExceptionFilter(makeCls(undefined));
    const host = makeHost('http', { [PROFILER_REQ_KEY]: profile });

    filter.catch(new UnauthorizedException(), host);

    expect(profile.exceptions).toHaveLength(1);
  });

  it('wraps non-Error throwables', () => {
    const profile = makeProfile();
    const filter = new ProfilerExceptionFilter(makeCls(profile));
    const host = makeHost('http', { [PROFILER_REQ_KEY]: profile });

    filter.catch('plain string failure', host);

    expect(profile.exceptions[0]).toMatchObject({
      name: 'Error',
      message: 'plain string failure',
    });
  });

  it('ignores non-HTTP contexts (handled by the interceptor) but still delegates', () => {
    const profile = makeProfile();
    const filter = new ProfilerExceptionFilter(makeCls(profile));
    const host = makeHost('graphql', { [PROFILER_REQ_KEY]: profile });

    filter.catch(new Error('resolver failed'), host);

    expect(profile.exceptions).toHaveLength(0);
    expect(superCatch).toHaveBeenCalledTimes(1);
  });

  it('is resilient when no profile can be resolved', () => {
    const filter = new ProfilerExceptionFilter(makeCls(undefined));
    const host = makeHost('http', {});

    expect(() => filter.catch(new Error('orphan'), host)).not.toThrow();
    expect(superCatch).toHaveBeenCalledTimes(1);
  });

  it('tolerates being constructed without a ClsService', () => {
    const profile = makeProfile();
    const filter = new ProfilerExceptionFilter();
    const host = makeHost('http', { [PROFILER_REQ_KEY]: profile });

    filter.catch(new UnauthorizedException(), host);

    expect(profile.exceptions).toHaveLength(1);
  });
});
