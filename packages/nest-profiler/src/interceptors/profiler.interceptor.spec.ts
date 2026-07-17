import { BadRequestException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { ClsService } from 'nestjs-cls';
import { ProfilerInterceptor } from './profiler.interceptor';
import { PROFILER_DEFER_COLLECTION } from '../constants';
import { ProfilerCoreService } from '../services/profiler-core.service';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { HttpRequestData, Profile } from '../interfaces/profile.interface';
import type { PlatformRequest, PlatformResponse } from '../types/http';
import type { IContextAdapter } from '../adapters/context-adapter.interface';

function makeProfile(): Profile<HttpRequestData> {
  return {
    token: 'tok',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/hello', headers: {}, query: {} } },
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
  } as Partial<PlatformResponse> as PlatformResponse;
}

function makeResWithFinish(
  statusCode = 200,
  headers: Record<string, string> = {},
): PlatformResponse & { triggerFinish(): void } {
  let finishCb: (() => void) | undefined;
  return {
    statusCode,
    getHeaders: () => ({ ...headers }),
    getHeader: (k: string) => headers[k.toLowerCase()],
    once: (_event: string, fn: () => void) => {
      finishCb = fn;
    },
    triggerFinish: () => finishCb?.(),
  } as Partial<PlatformResponse> & { triggerFinish(): void } as PlatformResponse & {
    triggerFinish(): void;
  };
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
  } as ExecutionContext;
}

interface CoreMock {
  storage: { save: jest.Mock };
  collectorRegistry: { collectAll: jest.Mock; buildPanels: jest.Mock };
  routeCollector: { match: jest.Mock };
  findContextAdapter: jest.Mock;
  registerContextAdapter: jest.Mock;
  enrichHttpResponse: jest.Mock;
  schedulePersist: jest.Mock;
  scheduleSave: jest.Mock;
}

function makeCore(adapter?: IContextAdapter): CoreMock {
  const core: CoreMock = {
    storage: { save: jest.fn() },
    collectorRegistry: {
      collectAll: jest.fn().mockResolvedValue(undefined),
      buildPanels: jest.fn().mockReturnValue([]),
    },
    routeCollector: { match: jest.fn().mockReturnValue(undefined) },
    findContextAdapter: jest.fn().mockReturnValue(adapter ?? undefined),
    registerContextAdapter: jest.fn(),
    enrichHttpResponse: jest.fn(),
    // Mirror the real methods synchronously so assertions on collectAll/save stay deterministic.
    schedulePersist: jest.fn((profile: Profile) => {
      void core.collectorRegistry.collectAll(profile);
      core.storage.save(profile);
    }),
    scheduleSave: jest.fn((profile: Profile) => {
      core.storage.save(profile);
    }),
  };
  return core;
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
): ProfilerInterceptor {
  const cls = makeClsService(profile, clsThrows);
  return new ProfilerInterceptor(
    cls as object as ClsService,
    core as object as ProfilerCoreService,
    options,
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

  describe('HTTP success path', () => {
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

    it('applies bodyCaptureLimits to the captured response body', async () => {
      const profile = makeProfile();
      const core = makeCore();
      const interceptor = makeInterceptor(profile, core, {
        collectBody: true,
        bodyCaptureLimits: { maxStringLength: 4 },
      });

      await lastValueFrom(
        interceptor.intercept(
          makeCtx({ method: 'GET', url: '/hello' }, makeRes()),
          handler({ message: 'HelloWorld' }),
        ),
      );

      expect(profile.response?.body).toEqual({ message: 'Hell… [truncated]' });
    });

    it('keeps the full response body when every cap is disabled', async () => {
      const profile = makeProfile();
      const core = makeCore();
      const interceptor = makeInterceptor(profile, core, {
        collectBody: true,
        maxBodySize: 0,
        bodyCaptureLimits: { maxStringLength: 0, maxItems: 0, maxDepth: 0 },
      });

      const long = 'x'.repeat(5000);
      await lastValueFrom(
        interceptor.intercept(
          makeCtx({ method: 'GET', url: '/hello' }, makeRes()),
          handler({ message: long }),
        ),
      );

      expect(profile.response?.body).toEqual({ message: long });
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
    it('injects the toolbar into HTML responses with a </body>', async () => {
      const profile = makeProfile();
      const core = makeCore();
      const res = makeRes({ 'content-type': 'text/html; charset=utf-8' });
      const interceptor = makeInterceptor(profile, core);

      const result = (await lastValueFrom(
        interceptor.intercept(
          makeCtx({ method: 'GET', url: '/page' }, res),
          handler('<html><body>hi</body></html>'),
        ),
      )) as string;

      expect(result).toContain('id="profiler-toolbar"');
      expect(result).toContain('/_profiler/');
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

  describe('deferred persistence (no response-path overhead)', () => {
    it('emits a JSON response without waiting for collectors or storage', async () => {
      const profile = makeProfile();
      const core = makeCore();
      // schedulePersist does nothing at all: the response must not depend on it.
      core.schedulePersist = jest.fn();
      const res = makeRes({ 'content-type': 'application/json' });
      const interceptor = makeInterceptor(profile, core);

      const result = await lastValueFrom(
        interceptor.intercept(makeCtx({ method: 'GET', url: '/api' }, res), handler({ ok: true })),
      );

      expect(result).toEqual({ ok: true });
      expect(core.schedulePersist).toHaveBeenCalledWith(profile);
      expect(core.collectorRegistry.collectAll).not.toHaveBeenCalled();
    });

    it('rethrows errors without waiting for collectors or storage', async () => {
      const profile = makeProfile();
      const core = makeCore();
      core.schedulePersist = jest.fn();
      const res = makeRes();
      const interceptor = makeInterceptor(profile, core);

      await expect(
        lastValueFrom(
          interceptor.intercept(
            makeCtx({ method: 'GET', url: '/api' }, res),
            errorHandler(new Error('boom')),
          ),
        ),
      ).rejects.toThrow('boom');

      expect(core.schedulePersist).toHaveBeenCalledWith(profile);
      expect(profile.exceptions).toHaveLength(1);
    });

    it('HTML responses still wait for collectors so the toolbar shows their panels', async () => {
      const profile = makeProfile();
      const core = makeCore();
      let resolveCollect: () => void = () => undefined;
      core.collectorRegistry.collectAll = jest.fn(
        () => new Promise<void>((resolve) => (resolveCollect = resolve)),
      );
      const res = makeRes({ 'content-type': 'text/html; charset=utf-8' });
      const interceptor = makeInterceptor(profile, core);

      let emitted: unknown;
      const done = lastValueFrom(
        interceptor.intercept(
          makeCtx({ method: 'GET', url: '/page' }, res),
          handler('<html><body>hi</body></html>'),
        ),
      ).then((value) => (emitted = value));

      await new Promise((resolve) => setImmediate(resolve));
      expect(emitted).toBeUndefined(); // gated on collectAll

      resolveCollect();
      await done;
      expect(emitted as string).toContain('id="profiler-toolbar"');
      expect(core.scheduleSave).toHaveBeenCalledWith(profile);
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
      } as ExecutionContext;
    }

    function makeAdapter(profile: Profile | null): AdapterMock {
      return {
        contextType: 'graphql',
        recoverProfile: jest.fn(() => profile),
        enrichProfile: jest.fn(),
      };
    }

    it('passes through when no adapter is registered for the context type', async () => {
      const core = makeCore(); // findContextAdapter returns undefined
      const interceptor = makeInterceptor(undefined, core);

      const result = await lastValueFrom(interceptor.intercept(makeGqlCtx(), handler({ data: 1 })));

      expect(result).toEqual({ data: 1 });
      expect(core.storage.save).not.toHaveBeenCalled();
    });

    it('passes through when adapter returns null (profile not recoverable)', async () => {
      const adapter = makeAdapter(null);
      const core = makeCore(adapter);
      const interceptor = makeInterceptor(undefined, core);

      const result = await lastValueFrom(interceptor.intercept(makeGqlCtx(), handler('data')));

      expect(result).toBe('data');
      expect(core.storage.save).not.toHaveBeenCalled();
    });

    it('recovers profile via adapter, enriches and saves when CLS is broken', async () => {
      const profile = makeProfile();
      const adapter = makeAdapter(profile);
      const core = makeCore(adapter);
      const interceptor = makeInterceptor(undefined, core);
      const resolverResult = { books: [] };

      const result = await lastValueFrom(
        interceptor.intercept(makeGqlCtx(), handler(resolverResult)),
      );

      expect(result).toBe(resolverResult);
      expect(profile.response).toEqual({ statusCode: 200, headers: {}, body: resolverResult });
      expect(adapter.enrichProfile).toHaveBeenCalledWith(profile, expect.any(Object));
      expect(core.collectorRegistry.collectAll).toHaveBeenCalledWith(profile);
      expect(core.storage.save).toHaveBeenCalledWith(profile);
    });

    it('re-establishes CLS context when profile is recovered from req', async () => {
      const profile = makeProfile();
      const adapter = makeAdapter(profile);
      const core = makeCore(adapter);
      const cls = makeClsService(undefined);
      const interceptor = new ProfilerInterceptor(
        cls as unknown as ClsService,
        core as unknown as ProfilerCoreService,
        {},
      );

      await lastValueFrom(interceptor.intercept(makeGqlCtx(), handler('result')));

      expect(cls.run.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(cls.set).toHaveBeenCalledWith('profiler.profile', profile);
      expect(cls.set).toHaveBeenCalledWith('profiler.token', profile.token);
    });

    it('routes to processNonHttp when profile is already in CLS for a GraphQL context', async () => {
      const profile = makeProfile();
      const adapter = makeAdapter(profile);
      const core = makeCore(adapter);
      // profile in CLS, context is 'graphql' — must NOT call processHttp
      const interceptor = makeInterceptor(profile, core);

      const result = await lastValueFrom(interceptor.intercept(makeGqlCtx(), handler({ data: 1 })));

      expect(result).toEqual({ data: 1 });
      expect(profile.response).toEqual({ statusCode: 200, headers: {}, body: { data: 1 } });
    });

    it('defers collection to the finish hook when the profile is marked for it', async () => {
      const profile = makeProfile();
      // The middleware marks the profile once its finish listener is registered; the finish hook
      // then collects after every field resolver, so the interceptor must not finalize early.
      (profile as unknown as Record<symbol, unknown>)[PROFILER_DEFER_COLLECTION] = true;
      const adapter = makeAdapter(profile);
      const core = makeCore(adapter);
      const interceptor = makeInterceptor(profile, core);

      const result = await lastValueFrom(interceptor.intercept(makeGqlCtx(), handler({ data: 1 })));

      expect(result).toEqual({ data: 1 });
      expect(profile.response).toBeUndefined();
      expect(core.schedulePersist).not.toHaveBeenCalled();
      expect(core.collectorRegistry.collectAll).not.toHaveBeenCalled();
      expect(core.storage.save).not.toHaveBeenCalled();
    });

    it('records the exception but leaves persistence to the finish hook when deferred', async () => {
      const profile = makeProfile();
      (profile as unknown as Record<symbol, unknown>)[PROFILER_DEFER_COLLECTION] = true;
      const adapter = makeAdapter(profile);
      const core = makeCore(adapter);
      const interceptor = makeInterceptor(profile, core);
      const error = new BadRequestException('invalid input');

      await expect(
        lastValueFrom(interceptor.intercept(makeGqlCtx(), errorHandler(error))),
      ).rejects.toBe(error);

      expect(profile.exceptions[0]?.message).toBe('invalid input');
      expect(profile.response).toBeUndefined();
      expect(core.schedulePersist).not.toHaveBeenCalled();
    });

    it('records HttpException status code from GraphQL resolver errors', async () => {
      const profile = makeProfile();
      const adapter = makeAdapter(profile);
      const core = makeCore(adapter);
      const interceptor = makeInterceptor(undefined, core);
      const error = new BadRequestException('invalid input');

      await expect(
        lastValueFrom(interceptor.intercept(makeGqlCtx(), errorHandler(error))),
      ).rejects.toBe(error);

      expect(profile.response?.statusCode).toBe(400);
    });

    it('handles a non-Error thrown value in the non-HTTP error path', async () => {
      const profile = makeProfile();
      const adapter = makeAdapter(profile);
      const core = makeCore(adapter);
      const interceptor = makeInterceptor(undefined, core);

      await expect(
        lastValueFrom(interceptor.intercept(makeGqlCtx(), errorHandler('oops'))),
      ).rejects.toBe('oops');

      expect(profile.exceptions[0]?.message).toBe('oops');
      expect(profile.response?.statusCode).toBe(500);
    });

    it('calls enrichProfile unconditionally even when graphql info is already set (adapters are idempotent)', async () => {
      const profile = makeProfile();
      profile.entrypoint.data.graphql = {
        operationType: 'query',
        fieldName: 'books',
      };
      const adapter = makeAdapter(profile);
      const core = makeCore(adapter);
      const interceptor = makeInterceptor(profile, core);

      await lastValueFrom(interceptor.intercept(makeGqlCtx(), handler(null)));

      expect(adapter.enrichProfile).toHaveBeenCalledWith(profile, expect.any(Object));
    });
  });

  describe('HTTP finish hook (safety net for direct-response frameworks)', () => {
    it('saves profile via finish hook when Observable never completes', async () => {
      const profile = makeProfile();
      const core = makeCore();
      const res = makeResWithFinish(400);
      const interceptor = makeInterceptor(profile, core);

      // The interceptor sets up the hook but we do NOT wait for the observable;
      // instead we trigger the finish event directly (simulating Apollo 400).
      const interceptorObs = interceptor.intercept(
        makeCtx({ method: 'POST', url: '/graphql' }, res),
        handler('body'),
      );

      // Trigger finish BEFORE the observable emits (simulates direct-response framework)
      res.triggerFinish();
      await new Promise((r) => setTimeout(r, 10));

      // The finish hook should have saved the profile
      expect(profile.response).toBeDefined();
      expect(profile.response?.statusCode).toBe(400);

      // Clean up
      interceptorObs.subscribe().unsubscribe();
    });

    it('finish hook skips when profile.response is already set (normal path ran)', async () => {
      const profile = makeProfile();
      const core = makeCore();
      const res = makeResWithFinish(200);
      const interceptor = makeInterceptor(profile, core);

      // Run the observable fully (normal path)
      await lastValueFrom(
        interceptor.intercept(makeCtx({ method: 'GET', url: '/api' }, res), handler('ok')),
      );

      const saveCount = core.storage.save.mock.calls.length;

      // Trigger finish — should NOT save again since profile.response is already set
      res.triggerFinish();
      await new Promise((r) => setTimeout(r, 10));

      expect(core.storage.save.mock.calls.length).toBe(saveCount);
    });
  });

  describe('HTTP error path', () => {
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
      expect(profile.exceptions[0]?.message).toBe('nope');
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

      expect(profile.exceptions[0]?.name).toBe('Error');
      expect(profile.exceptions[0]?.message).toBe('boom');
    });

    it('records a 500 for a non-HttpException error (MAJ-5)', async () => {
      const profile = makeProfile();
      const core = makeCore();
      const res = makeRes(); // res.statusCode stays 200 (exception filter runs later)
      const interceptor = makeInterceptor(profile, core);
      const error = new TypeError('kaboom');

      await expect(
        lastValueFrom(
          interceptor.intercept(
            makeCtx({ method: 'GET', url: '/hello' }, res),
            errorHandler(error),
          ),
        ),
      ).rejects.toBe(error);

      // Aligned with processNonHttp: a generic error is recorded as 500, not the stale 200.
      expect(profile.response?.statusCode).toBe(500);
    });
  });
});
