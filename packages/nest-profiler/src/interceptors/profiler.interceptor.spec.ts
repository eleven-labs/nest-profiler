import { BadRequestException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { ClsService } from 'nestjs-cls';
import { ProfilerInterceptor } from './profiler.interceptor';
import { ProfilerCoreService } from '../services/profiler-core.service';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { Profile } from '../interfaces/profile.interface';
import type { PlatformRequest, PlatformResponse } from '../types/http';
import type { IContextAdapter } from '../adapters/context-adapter.interface';
import { PROFILER_REQ_KEY } from '../constants';
import { GraphQLContextAdapter } from '../adapters/graphql-context.adapter';

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

function makeCtx(
  req: Partial<PlatformRequest>,
  res: PlatformResponse,
  type = 'http',
): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({
      getRequest: () => req as PlatformRequest,
      getResponse: () => res,
    }),
    getArgs: () => [],
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

interface ClsMock {
  get: jest.Mock;
  run: jest.Mock;
  set: jest.Mock;
}

function makeClsService(profile: Profile | undefined, clsThrows = false): ClsMock {
  const store: Record<string, unknown> = {};
  return {
    get: jest.fn(() => {
      if (clsThrows) throw new Error('outside CLS');
      return profile;
    }),
    run: jest.fn((fn: () => void) => fn()),
    set: jest.fn((key: string, value: unknown) => {
      store[key] = value;
    }),
  };
}

function makeInterceptor(
  profile: Profile | undefined,
  core: CoreMock,
  options: ProfilerModuleOptions = {},
  clsThrows = false,
  adapters: IContextAdapter[] = [],
): ProfilerInterceptor {
  const cls = makeClsService(profile, clsThrows);
  return new ProfilerInterceptor(
    cls as unknown as ClsService,
    core as unknown as ProfilerCoreService,
    options,
    adapters,
  );
}

interface AdapterMock {
  contextType: string;
  recoverProfile: jest.Mock;
  enrichProfile: jest.Mock;
}

function handler(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

function errorHandler(err: unknown): CallHandler {
  return { handle: () => throwError(() => err) };
}

describe('ProfilerInterceptor', () => {
  describe('constructor adapter normalization', () => {
    it('accepts a single adapter (not wrapped in array)', async () => {
      const profile = makeProfile();
      const adapter: AdapterMock = {
        contextType: 'graphql',
        recoverProfile: jest.fn(() => profile),
        enrichProfile: jest.fn(),
      };
      const core = makeCore();
      const cls = makeClsService(undefined);
      const interceptor = new ProfilerInterceptor(
        cls as unknown as ClsService,
        core as unknown as ProfilerCoreService,
        {},
        adapter,
      );

      const gqlCtx: ExecutionContext = {
        getType: () => 'graphql',
        getArgs: () => [],
        switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({}) }),
      } as unknown as ExecutionContext;

      const result = await lastValueFrom(interceptor.intercept(gqlCtx, handler('ok')));
      expect(result).toBe('ok');
      expect(core.storage.save).toHaveBeenCalled();
    });
  });

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

  describe('non-HTTP context (GraphQL / RPC)', () => {
    function makeGqlCtx(args: unknown[] = []): ExecutionContext {
      return {
        getType: () => 'graphql',
        getArgs: () => args,
        switchToHttp: () => ({
          getRequest: () => ({}),
          getResponse: () => ({ query: '{ _sdl }' }),
        }),
      } as unknown as ExecutionContext;
    }

    describe('with no adapter registered', () => {
      it('passes through when there are no adapters', async () => {
        const core = makeCore();
        const interceptor = makeInterceptor(undefined, core, {}, false, []);

        const result = await lastValueFrom(
          interceptor.intercept(makeGqlCtx(), handler({ data: 1 })),
        );

        expect(result).toEqual({ data: 1 });
        expect(core.storage.save).not.toHaveBeenCalled();
      });
    });

    describe('with a GraphQL adapter', () => {
      function makeAdapter(profile: Profile | null): AdapterMock {
        return {
          contextType: 'graphql',
          recoverProfile: jest.fn(() => profile),
          enrichProfile: jest.fn(),
        };
      }

      it('recovers profile via adapter and captures resolver result as body', async () => {
        const profile = makeProfile();
        const adapter = makeAdapter(profile);
        const core = makeCore();
        const interceptor = makeInterceptor(undefined, core, {}, false, [adapter]);
        const resolverResult = { books: [] };

        const result = await lastValueFrom(
          interceptor.intercept(makeGqlCtx(), handler(resolverResult)),
        );

        expect(result).toBe(resolverResult);
        expect(profile.performance.duration).toBeGreaterThanOrEqual(0);
        expect(profile.response).toEqual({ statusCode: 200, headers: {}, body: resolverResult });
        expect(adapter.enrichProfile).toHaveBeenCalledWith(profile, expect.any(Object));
        expect(core.collectorRegistry.collectAll).toHaveBeenCalledWith(profile);
        expect(core.storage.save).toHaveBeenCalledWith(profile);
      });

      it('re-establishes CLS context so ProfilerService works in resolvers', async () => {
        const profile = makeProfile();
        const adapter = makeAdapter(profile);
        const core = makeCore();
        const cls = makeClsService(undefined);
        const interceptor = new ProfilerInterceptor(
          cls as unknown as ClsService,
          core as unknown as ProfilerCoreService,
          {},
          [adapter],
        );

        await lastValueFrom(interceptor.intercept(makeGqlCtx(), handler('result')));

        expect(cls.run.mock.calls.length).toBeGreaterThanOrEqual(1);
        expect(cls.set).toHaveBeenCalledWith('profiler.profile', profile);
        expect(cls.set).toHaveBeenCalledWith('profiler.token', profile.token);
      });

      it('records exceptions with status 500 for generic resolver errors', async () => {
        const profile = makeProfile();
        const adapter = makeAdapter(profile);
        const core = makeCore();
        const interceptor = makeInterceptor(undefined, core, {}, false, [adapter]);
        const error = new Error('resolver failed');

        await expect(
          lastValueFrom(interceptor.intercept(makeGqlCtx(), errorHandler(error))),
        ).rejects.toBe(error);

        expect(profile.exceptions).toHaveLength(1);
        expect(profile.exceptions[0].message).toBe('resolver failed');
        expect(profile.response?.statusCode).toBe(500);
        expect(core.storage.save).toHaveBeenCalledWith(profile);
      });

      it('records HttpException status code from GraphQL resolvers', async () => {
        const profile = makeProfile();
        const adapter = makeAdapter(profile);
        const core = makeCore();
        const interceptor = makeInterceptor(undefined, core, {}, false, [adapter]);
        const error = new BadRequestException('invalid input');

        await expect(
          lastValueFrom(interceptor.intercept(makeGqlCtx(), errorHandler(error))),
        ).rejects.toBe(error);

        expect(profile.response?.statusCode).toBe(400);
      });

      it('passes through when adapter returns null (profile not on req)', async () => {
        const adapter = makeAdapter(null);
        const core = makeCore();
        const interceptor = makeInterceptor(undefined, core, {}, false, [adapter]);

        const result = await lastValueFrom(interceptor.intercept(makeGqlCtx(), handler('data')));

        expect(result).toBe('data');
        expect(core.storage.save).not.toHaveBeenCalled();
      });

      it('recovers profile via gqlCtx.req[PROFILER_REQ_KEY] (integration with real adapter)', async () => {
        const realAdapter = new GraphQLContextAdapter();

        const profile = makeProfile();
        const req = { [PROFILER_REQ_KEY]: profile };
        const info = { fieldName: 'books', operation: { operation: 'query' } };
        const gqlCtx = makeGqlCtx([undefined, undefined, { req }, info]);

        const core = makeCore();
        const interceptor = makeInterceptor(undefined, core, {}, false, [realAdapter]);

        const result = await lastValueFrom(interceptor.intercept(gqlCtx, handler(['book1'])));

        expect(result).toEqual(['book1']);
        expect(profile.request.graphql?.operationType).toBe('query');
        expect(profile.request.graphql?.fieldName).toBe('books');
        expect(core.storage.save).toHaveBeenCalledWith(profile);
      });
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
