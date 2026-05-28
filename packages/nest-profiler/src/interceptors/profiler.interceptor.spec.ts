import { BadRequestException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { ClsService } from 'nestjs-cls';
import { ProfilerInterceptor } from './profiler.interceptor';
import { ProfilerCoreService } from '../services/profiler-core.service';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { Profile } from '../interfaces/profile.interface';
import type { PlatformRequest, PlatformResponse } from '../types/http';

function makeProfile(): Profile {
  return {
    token: 'tok',
    createdAt: Date.now(),
    request: { method: 'GET', url: '/hello', headers: {}, query: {} },
    performance: { startTime: Date.now() - 5, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

function makeRes(headers: Record<string, string> = {}): PlatformResponse {
  return {
    statusCode: 200,
    getHeaders: () => ({ ...headers }),
    getHeader: (k: string) => headers[k.toLowerCase()],
  } as unknown as PlatformResponse;
}

function makeCtx(req: Partial<PlatformRequest>, res: PlatformResponse): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req as PlatformRequest,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

interface CoreMock {
  storage: { save: jest.Mock };
  collectorRegistry: { collectAll: jest.Mock; buildPanels: jest.Mock };
  routeCollector: { match: jest.Mock };
}

function makeCore(): CoreMock {
  return {
    storage: { save: jest.fn() },
    collectorRegistry: {
      collectAll: jest.fn().mockResolvedValue(undefined),
      buildPanels: jest.fn().mockReturnValue([]),
    },
    routeCollector: { match: jest.fn().mockReturnValue(undefined) },
  };
}

function makeInterceptor(
  profile: Profile | undefined,
  core: CoreMock,
  options: ProfilerModuleOptions = {},
  clsThrows = false,
): ProfilerInterceptor {
  const cls = {
    get: jest.fn(() => {
      if (clsThrows) throw new Error('outside CLS');
      return profile;
    }),
  } as unknown as ClsService;
  return new ProfilerInterceptor(cls, core as unknown as ProfilerCoreService, options);
}

function handler(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

function errorHandler(err: unknown): CallHandler {
  return { handle: () => throwError(() => err) };
}

describe('ProfilerInterceptor', () => {
  describe('without an active profile', () => {
    it('passes through when CLS has no profile', async () => {
      const core = makeCore();
      const interceptor = makeInterceptor(undefined, core);
      const result = await lastValueFrom(
        interceptor.intercept(makeCtx({}, makeRes()), handler('body')),
      );
      expect(result).toBe('body');
      expect(core.storage.save).not.toHaveBeenCalled();
      expect(core.collectorRegistry.collectAll).not.toHaveBeenCalled();
    });

    it('passes through when CLS access throws (outside CLS context)', async () => {
      const core = makeCore();
      const interceptor = makeInterceptor(undefined, core, {}, true);
      const result = await lastValueFrom(
        interceptor.intercept(makeCtx({}, makeRes()), handler('body')),
      );
      expect(result).toBe('body');
      expect(core.storage.save).not.toHaveBeenCalled();
    });
  });

  describe('success path', () => {
    it('finalizes the profile, runs collectors, saves and returns the body', async () => {
      const profile = makeProfile();
      const core = makeCore();
      const res = makeRes();
      const interceptor = makeInterceptor(profile, core);

      const result = await lastValueFrom(
        interceptor.intercept(makeCtx({ method: 'GET', url: '/hello' }, res), handler('body')),
      );

      expect(result).toBe('body');
      expect(profile.performance.duration).toBeGreaterThanOrEqual(0);
      expect(profile.response).toEqual({ statusCode: 200, headers: {}, body: undefined });
      expect(core.collectorRegistry.collectAll).toHaveBeenCalledWith(profile);
      expect(core.storage.save).toHaveBeenCalledWith(profile);
    });

    it('captures the response body only when collectBody is enabled', async () => {
      const profile = makeProfile();
      const core = makeCore();
      const interceptor = makeInterceptor(profile, core, { collectBody: true });

      await lastValueFrom(
        interceptor.intercept(
          makeCtx({ method: 'GET', url: '/hello' }, makeRes()),
          handler('body'),
        ),
      );

      expect(profile.response?.body).toBe('body');
    });

    it('updates the route from the route collector when matched', async () => {
      const profile = makeProfile();
      const core = makeCore();
      const route = {
        controller: 'AppController',
        handler: 'hello',
        path: '/hello',
        method: 'GET',
      };
      core.routeCollector.match.mockReturnValue(route);
      const interceptor = makeInterceptor(profile, core);

      await lastValueFrom(
        interceptor.intercept(
          makeCtx({ method: 'GET', url: '/hello' }, makeRes()),
          handler('body'),
        ),
      );

      expect(profile.route).toBe(route);
    });
  });

  describe('toolbar injection', () => {
    it('injects the toolbar into HTML responses with a </body>, honoring a custom path', async () => {
      const profile = makeProfile();
      const core = makeCore();
      const res = makeRes({ 'content-type': 'text/html; charset=utf-8' });
      const interceptor = makeInterceptor(profile, core, { path: '/__debug' });

      const result = (await lastValueFrom(
        interceptor.intercept(
          makeCtx({ method: 'GET', url: '/page' }, res),
          handler('<html><body>hi</body></html>'),
        ),
      )) as string;

      expect(result).toContain('id="profiler-toolbar"');
      expect(result).toContain('/__debug/');
      expect(result.indexOf('id="profiler-toolbar"')).toBeLessThan(result.indexOf('</body>'));
    });

    it('leaves non-HTML responses untouched', async () => {
      const profile = makeProfile();
      const core = makeCore();
      const res = makeRes({ 'content-type': 'application/json' });
      const interceptor = makeInterceptor(profile, core);

      const result = await lastValueFrom(
        interceptor.intercept(makeCtx({ method: 'GET', url: '/api' }, res), handler({ ok: true })),
      );

      expect(result).toEqual({ ok: true });
    });
  });

  describe('error path', () => {
    it('records the exception, overrides the status from HttpException, saves and rethrows', async () => {
      const profile = makeProfile();
      const core = makeCore();
      const res = makeRes();
      const interceptor = makeInterceptor(profile, core);
      const error = new BadRequestException('nope');

      await expect(
        lastValueFrom(
          interceptor.intercept(
            makeCtx({ method: 'GET', url: '/hello' }, res),
            errorHandler(error),
          ),
        ),
      ).rejects.toBe(error);

      expect(profile.exceptions).toHaveLength(1);
      expect(profile.exceptions[0].message).toBe('nope');
      expect(profile.response?.statusCode).toBe(400);
      expect(core.collectorRegistry.collectAll).toHaveBeenCalledWith(profile);
      expect(core.storage.save).toHaveBeenCalledWith(profile);
    });

    it('normalizes a non-Error thrown value into an Error', async () => {
      const profile = makeProfile();
      const core = makeCore();
      const interceptor = makeInterceptor(profile, core);

      await expect(
        lastValueFrom(
          interceptor.intercept(
            makeCtx({ method: 'GET', url: '/hello' }, makeRes()),
            errorHandler('boom'),
          ),
        ),
      ).rejects.toBe('boom');

      expect(profile.exceptions[0].name).toBe('Error');
      expect(profile.exceptions[0].message).toBe('boom');
    });
  });
});
