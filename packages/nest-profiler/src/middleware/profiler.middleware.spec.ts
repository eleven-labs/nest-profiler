import { AsyncLocalStorage } from 'node:async_hooks';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { ProfilerMiddleware } from './profiler.middleware';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { HttpRequestData, Profile } from '../interfaces/profile.interface';
import type { PlatformRequest, PlatformResponse } from '../types/http';
import type { ProfilerCoreService } from '../services/profiler-core.service';

/** Reads the HTTP request data from a possibly-undefined profile's entrypoint. */
function reqData(profile: Profile<HttpRequestData> | undefined): HttpRequestData | undefined {
  return profile?.entrypoint?.data;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRes(): PlatformResponse {
  const stored: Record<string, string | string[]> = {};
  return {
    setHeader(k: string, v: string | string[]) {
      stored[k] = v;
    },
    getHeader(k: string) {
      return stored[k];
    },
    getHeaders() {
      return stored;
    },
    statusCode: 200,
  } as Partial<PlatformResponse> as PlatformResponse;
}

/**
 * Runs the middleware and returns the Profile stored in CLS by the time `next()` is called.
 * Returns undefined when the request is skipped (profiler path, sample-rate, ignore-paths).
 */
function runMiddleware(
  middleware: ProfilerMiddleware,
  req: Partial<PlatformRequest>,
  cls: ClsService,
): Promise<Profile<HttpRequestData> | undefined> {
  return new Promise<Profile<HttpRequestData> | undefined>((resolve) => {
    const next = () => {
      try {
        resolve(cls.get<Profile<HttpRequestData> | undefined>('profiler.profile'));
      } catch {
        resolve(undefined); // called outside CLS context — request was skipped
      }
    };
    middleware.use(req as PlatformRequest, makeRes(), next);
  });
}

async function createMiddleware(
  options: ProfilerModuleOptions = {},
): Promise<{ middleware: ProfilerMiddleware; cls: ClsService }> {
  const module = await Test.createTestingModule({
    imports: [ClsModule.forRoot({ middleware: { mount: false } })],
    providers: [ProfilerMiddleware, { provide: NEST_PROFILER_MODULE_OPTIONS, useValue: options }],
  }).compile();
  return {
    middleware: module.get(ProfilerMiddleware),
    cls: module.get(ClsService),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProfilerMiddleware', () => {
  describe('Express adapter (req has path / originalUrl / cookies)', () => {
    let middleware: ProfilerMiddleware;
    let cls: ClsService;

    beforeEach(async () => {
      ({ middleware, cls } = await createMiddleware());
    });

    it('uses req.originalUrl as profile request url', async () => {
      const profile = await runMiddleware(
        middleware,
        {
          method: 'GET',
          url: '/users',
          path: '/users',
          originalUrl: '/users?page=2',
          headers: {},
          query: { page: '2' },
        },
        cls,
      );

      expect(profile).toBeDefined();
      expect(reqData(profile)?.url).toBe('/users?page=2');
    });

    it('captures cookies from req.cookies when already parsed', async () => {
      const profile = await runMiddleware(
        middleware,
        {
          method: 'GET',
          url: '/users',
          path: '/users',
          headers: {},
          query: {},
          cookies: { session_id: 'abc123', theme: 'dark' },
        },
        cls,
      );

      expect(reqData(profile)?.cookies).toEqual({ session_id: 'abc123', theme: 'dark' });
    });

    it('masks specified cookie values', async () => {
      ({ middleware, cls } = await createMiddleware({ maskCookies: ['auth_token'] }));

      const profile = await runMiddleware(
        middleware,
        {
          method: 'GET',
          url: '/me',
          path: '/me',
          headers: {},
          query: {},
          cookies: { auth_token: 'secret', user_id: '42' },
        },
        cls,
      );

      expect(reqData(profile)?.cookies?.['auth_token']).toBe('[REDACTED]');
      expect(reqData(profile)?.cookies?.['user_id']).toBe('42');
    });

    it('captures session data when req.session is present', async () => {
      const profile = await runMiddleware(
        middleware,
        {
          method: 'GET',
          url: '/dashboard',
          path: '/dashboard',
          headers: {},
          query: {},
          session: { userId: 7, role: 'admin' },
        },
        cls,
      );

      expect(reqData(profile)?.session).toEqual({ userId: 7, role: 'admin' });
    });

    it('excludes the profiler path itself from profiling', async () => {
      const profile = await runMiddleware(
        middleware,
        { method: 'GET', url: '/_profiler', path: '/_profiler', headers: {}, query: {} },
        cls,
      );

      expect(profile).toBeUndefined();
    });
  });

  describe('Fastify adapter (req has only url, no path / originalUrl / cookies)', () => {
    let middleware: ProfilerMiddleware;
    let cls: ClsService;

    beforeEach(async () => {
      ({ middleware, cls } = await createMiddleware());
    });

    it('falls back to req.url when path and originalUrl are absent', async () => {
      const profile = await runMiddleware(
        middleware,
        {
          method: 'GET',
          url: '/products',
          // no path, no originalUrl
          headers: {},
          query: {},
        },
        cls,
      );

      expect(profile).toBeDefined();
      expect(reqData(profile)?.url).toBe('/products');
    });

    it('parses cookies from Cookie header when req.cookies is absent', async () => {
      const profile = await runMiddleware(
        middleware,
        {
          method: 'GET',
          url: '/products',
          headers: { cookie: 'session_id=xyz; theme=light' },
          query: {},
          // no cookies object
        },
        cls,
      );

      expect(reqData(profile)?.cookies).toEqual({ session_id: 'xyz', theme: 'light' });
    });

    it('has no cookies field when neither req.cookies nor Cookie header are present', async () => {
      const profile = await runMiddleware(
        middleware,
        { method: 'GET', url: '/products', headers: {}, query: {} },
        cls,
      );

      expect(reqData(profile)?.cookies).toBeUndefined();
    });

    it('has no session field when req.session is absent', async () => {
      const profile = await runMiddleware(
        middleware,
        { method: 'GET', url: '/products', headers: {}, query: {} },
        cls,
      );

      expect(reqData(profile)?.session).toBeUndefined();
    });

    it('excludes profiler path using url when path is absent', async () => {
      const profile = await runMiddleware(
        middleware,
        { method: 'GET', url: '/_profiler', headers: {}, query: {} },
        cls,
      );

      expect(profile).toBeUndefined();
    });

    it('uses ip from req.ip when present', async () => {
      const profile = await runMiddleware(
        middleware,
        { method: 'POST', url: '/orders', headers: {}, query: {}, ip: '192.168.1.1' },
        cls,
      );

      expect(reqData(profile)?.ip).toBe('192.168.1.1');
    });
  });

  describe('shared behaviour (platform-independent)', () => {
    let middleware: ProfilerMiddleware;
    let cls: ClsService;

    beforeEach(async () => {
      ({ middleware, cls } = await createMiddleware());
    });

    it('sets X-Debug-Token response header', async () => {
      const res = makeRes();
      await new Promise<void>((resolve) => {
        middleware.use(
          { method: 'GET', url: '/ping', headers: {}, query: {} } as PlatformRequest,
          res,
          () => resolve(),
        );
      });

      expect(res.getHeader('X-Debug-Token')).toBeDefined();
    });

    it('does not emit debug headers when emitDebugHeaders is false', async () => {
      ({ middleware, cls } = await createMiddleware({ emitDebugHeaders: false }));
      const res = makeRes();
      await new Promise<void>((resolve) => {
        middleware.use(
          { method: 'GET', url: '/ping', headers: {}, query: {} } as PlatformRequest,
          res,
          () => resolve(),
        );
      });

      expect(res.getHeader('X-Debug-Token')).toBeUndefined();
    });

    it('redacts sensitive request headers by default (authorization, cookie, x-api-key)', async () => {
      const profile = await runMiddleware(
        middleware,
        {
          method: 'GET',
          url: '/p',
          headers: {
            authorization: 'Bearer supersecret',
            cookie: 'session=abc',
            'x-api-key': 'k-123',
            'x-custom': 'keep-me',
          },
          query: {},
        },
        cls,
      );

      const headers = reqData(profile)?.headers ?? {};
      expect(headers['authorization']).toBe('[REDACTED]');
      expect(headers['cookie']).toBe('[REDACTED]');
      expect(headers['x-api-key']).toBe('[REDACTED]');
      expect(headers['x-custom']).toBe('keep-me');
    });

    it('merges maskHeaders on top of the defaults instead of replacing them', async () => {
      ({ middleware, cls } = await createMiddleware({ maskHeaders: ['x-trace'] }));
      const profile = await runMiddleware(
        middleware,
        {
          method: 'GET',
          url: '/p',
          headers: { authorization: 'Bearer s', 'x-trace': 't-1', 'x-custom': 'keep-me' },
          query: {},
        },
        cls,
      );

      const headers = reqData(profile)?.headers ?? {};
      expect(headers['x-trace']).toBe('[REDACTED]');
      // Naming one extra header must not drop the built-in protections.
      expect(headers['authorization']).toBe('[REDACTED]');
      expect(headers['x-custom']).toBe('keep-me');
    });

    it('drops the built-in header list only when useDefaultMaskHeaders is false', async () => {
      ({ middleware, cls } = await createMiddleware({
        maskHeaders: ['x-trace'],
        useDefaultMaskHeaders: false,
      }));
      const profile = await runMiddleware(
        middleware,
        {
          method: 'GET',
          url: '/p',
          headers: { authorization: 'Bearer s', 'x-trace': 't-1' },
          query: {},
        },
        cls,
      );

      const headers = reqData(profile)?.headers ?? {};
      expect(headers['x-trace']).toBe('[REDACTED]');
      expect(headers['authorization']).toBe('Bearer s');
    });

    it('masks sensitive query-parameter values in the captured url and query', async () => {
      const profile = await runMiddleware(
        middleware,
        {
          method: 'GET',
          url: '/reset?token=eyJhbGciOiJIUzI1NiJ9.abc.def&email=a@b.c',
          originalUrl: '/reset?token=eyJhbGciOiJIUzI1NiJ9.abc.def&email=a@b.c',
          headers: {},
          query: { token: 'eyJhbGciOiJIUzI1NiJ9.abc.def', email: 'a@b.c' },
        },
        cls,
      );

      const data = reqData(profile);
      // Names are kept, only values masked — the trace still says a token was carried.
      expect(data?.url).toBe('/reset?token=%5BREDACTED%5D&email=a%40b.c');
      expect(data?.query).toEqual({ token: '[REDACTED]', email: 'a@b.c' });
    });

    it('masks OAuth and signed-URL parameters, matching names case- and separator-insensitively', async () => {
      const profile = await runMiddleware(
        middleware,
        {
          method: 'GET',
          url: '/cb?code=4%2F0AY0e-g7&State=xyz&Access-Token=at-1&signature=8f14e45f&page=2',
          headers: {},
          query: {
            code: '4/0AY0e-g7',
            State: 'xyz',
            'Access-Token': 'at-1',
            signature: '8f14e45f',
            page: '2',
          },
        },
        cls,
      );

      const data = reqData(profile);
      expect(data?.query).toEqual({
        code: '[REDACTED]',
        State: '[REDACTED]',
        'Access-Token': '[REDACTED]',
        signature: '[REDACTED]',
        page: '2',
      });
      expect(data?.url).toContain('page=2');
      expect(data?.url).not.toContain('4%2F0AY0e-g7');
      expect(data?.url).not.toContain('at-1');
    });

    it('leaves a url with nothing to mask exactly as it arrived', async () => {
      const profile = await runMiddleware(
        middleware,
        {
          method: 'GET',
          url: '/users?sort=name&page=2',
          headers: {},
          query: { sort: 'name', page: '2' },
        },
        cls,
      );

      // Not re-serialised through URLSearchParams — a benign URL is stored verbatim.
      expect(reqData(profile)?.url).toBe('/users?sort=name&page=2');
    });

    it('merges maskQueryParams on top of the defaults', async () => {
      ({ middleware, cls } = await createMiddleware({ maskQueryParams: ['inviteRef'] }));
      const profile = await runMiddleware(
        middleware,
        {
          method: 'GET',
          url: '/join?inviteRef=r-1&token=t-1&team=eleven',
          headers: {},
          query: { inviteRef: 'r-1', token: 't-1', team: 'eleven' },
        },
        cls,
      );

      expect(reqData(profile)?.query).toEqual({
        inviteRef: '[REDACTED]',
        token: '[REDACTED]',
        team: 'eleven',
      });
    });

    it('drops the built-in query list only when useDefaultMaskQueryParams is false', async () => {
      ({ middleware, cls } = await createMiddleware({
        maskQueryParams: ['inviteRef'],
        useDefaultMaskQueryParams: false,
      }));
      const profile = await runMiddleware(
        middleware,
        {
          method: 'GET',
          url: '/join?inviteRef=r-1&token=t-1',
          headers: {},
          query: { inviteRef: 'r-1', token: 't-1' },
        },
        cls,
      );

      expect(reqData(profile)?.query).toEqual({ inviteRef: '[REDACTED]', token: 't-1' });
    });

    it('masks every value of a repeated sensitive parameter', async () => {
      const profile = await runMiddleware(
        middleware,
        {
          method: 'GET',
          url: '/p?token=a&token=b',
          headers: {},
          query: { token: ['a', 'b'] },
        },
        cls,
      );

      expect(reqData(profile)?.query).toEqual({ token: ['[REDACTED]', '[REDACTED]'] });
      expect(reqData(profile)?.url).not.toMatch(/token=[ab]\b/);
    });

    it('sees the unredacted url in the ignoreRequest predicate', async () => {
      const seen: string[] = [];
      ({ middleware, cls } = await createMiddleware({
        ignoreRequest: (req) => {
          seen.push(req.url);
          return false;
        },
      }));
      await runMiddleware(
        middleware,
        { method: 'GET', url: '/p?token=secret-1', headers: {}, query: { token: 'secret-1' } },
        cls,
      );

      // The predicate decides what to profile, so it must see the real request.
      expect(seen).toEqual(['/p?token=secret-1']);
    });

    it('skips profiling when sampleRate is 0', async () => {
      ({ middleware, cls } = await createMiddleware({ sampleRate: 0 }));

      const profile = await runMiddleware(
        middleware,
        { method: 'GET', url: '/ping', headers: {}, query: {} },
        cls,
      );

      expect(profile).toBeUndefined();
    });

    it('skips profiling for ignored string prefix paths', async () => {
      ({ middleware, cls } = await createMiddleware({ ignorePaths: ['/health'] }));

      const profile = await runMiddleware(
        middleware,
        { method: 'GET', url: '/health/live', headers: {}, query: {} },
        cls,
      );

      expect(profile).toBeUndefined();
    });

    it('skips profiling for ignored RegExp paths', async () => {
      ({ middleware, cls } = await createMiddleware({ ignorePaths: [/^\/static\//] }));

      const profile = await runMiddleware(
        middleware,
        { method: 'GET', url: '/static/logo.png', headers: {}, query: {} },
        cls,
      );

      expect(profile).toBeUndefined();
    });

    it('captures body when collectBody is true', async () => {
      ({ middleware, cls } = await createMiddleware({ collectBody: true }));

      const profile = await runMiddleware(
        middleware,
        { method: 'POST', url: '/posts', headers: {}, query: {}, body: { title: 'Hello' } },
        cls,
      );

      expect(reqData(profile)?.body).toEqual({ title: 'Hello' });
    });

    it('does not capture body when collectBody is false (default)', async () => {
      const profile = await runMiddleware(
        middleware,
        { method: 'POST', url: '/posts', headers: {}, query: {}, body: { title: 'Hello' } },
        cls,
      );

      expect(reqData(profile)?.body).toBeUndefined();
    });

    it('applies bodyCaptureLimits to the captured request body', async () => {
      ({ middleware, cls } = await createMiddleware({
        collectBody: true,
        bodyCaptureLimits: { maxStringLength: 4 },
      }));

      const profile = await runMiddleware(
        middleware,
        { method: 'POST', url: '/posts', headers: {}, query: {}, body: { title: 'HelloWorld' } },
        cls,
      );

      expect(reqData(profile)?.body).toEqual({ title: 'Hell… [truncated]' });
    });

    it('keeps the full request body when every cap is disabled', async () => {
      ({ middleware, cls } = await createMiddleware({
        collectBody: true,
        maxBodySize: 0,
        bodyCaptureLimits: { maxStringLength: 0, maxItems: 0, maxDepth: 0 },
      }));

      const long = 'x'.repeat(5000);
      const profile = await runMiddleware(
        middleware,
        { method: 'POST', url: '/posts', headers: {}, query: {}, body: { title: long } },
        cls,
      );

      expect(reqData(profile)?.body).toEqual({ title: long });
    });

    it('always uses an internal UUID token, never the client x-request-id (no traversal/collision)', async () => {
      const profile = await runMiddleware(
        middleware,
        { method: 'GET', url: '/p', headers: { 'x-request-id': '../../evil' }, query: {} },
        cls,
      );
      // The hostile header value is never used as the storage token.
      expect(profile?.token).not.toBe('../../evil');
      expect(profile?.token).toMatch(/^[0-9a-f-]{36}$/);
      // It is preserved as a display-only correlation attribute instead.
      expect(reqData(profile)?.requestId).toBe('../../evil');
    });

    it('records the first value when x-request-id is an array, as a correlation attribute', async () => {
      const profile = await runMiddleware(
        middleware,
        { method: 'GET', url: '/p', headers: { 'x-request-id': ['req-a', 'req-b'] }, query: {} },
        cls,
      );
      expect(profile?.token).toMatch(/^[0-9a-f-]{36}$/);
      expect(reqData(profile)?.requestId).toBe('req-a');
    });

    it('excludes function values from captured session data', async () => {
      const profile = await runMiddleware(
        middleware,
        {
          method: 'GET',
          url: '/dash',
          headers: {},
          query: {},
          session: { userId: 1, save: () => undefined },
        },
        cls,
      );
      expect(reqData(profile)?.session).toEqual({ userId: 1 });
    });

    it('omits session data entirely when it contains only functions', async () => {
      const profile = await runMiddleware(
        middleware,
        {
          method: 'GET',
          url: '/dash',
          headers: {},
          query: {},
          session: { save: () => undefined, reload: () => undefined },
        },
        cls,
      );
      expect(reqData(profile)?.session).toBeUndefined();
    });

    it('skips malformed cookie segments without an "=" separator', async () => {
      const profile = await runMiddleware(
        middleware,
        { method: 'GET', url: '/p', headers: { cookie: 'flag; a=b' }, query: {} },
        cls,
      );
      expect(reqData(profile)?.cookies).toEqual({ a: 'b' });
    });
  });

  describe('ignoreRequest filter', () => {
    it('skips profiling when ignoreRequest returns true', async () => {
      const { middleware, cls } = await createMiddleware({ ignoreRequest: () => true });
      const profile = await runMiddleware(
        middleware,
        { method: 'POST', url: '/graphql', headers: {}, query: {} },
        cls,
      );
      expect(profile).toBeUndefined();
    });
  });

  describe('default ignore paths', () => {
    const noisyPaths = [
      '/favicon.ico',
      '/robots.txt',
      '/.well-known/appspecific/com.chrome.devtools.json',
      '/apple-touch-icon.png',
    ];

    it.each(noisyPaths)('skips profiling for %s by default', async (path) => {
      const { middleware, cls } = await createMiddleware();
      const profile = await runMiddleware(
        middleware,
        { method: 'GET', url: path, path, headers: {}, query: {} },
        cls,
      );
      expect(profile).toBeUndefined();
    });

    it('still profiles those paths when useDefaultIgnorePaths is false', async () => {
      const { middleware, cls } = await createMiddleware({ useDefaultIgnorePaths: false });
      const profile = await runMiddleware(
        middleware,
        { method: 'GET', url: '/favicon.ico', path: '/favicon.ico', headers: {}, query: {} },
        cls,
      );
      expect(profile).toBeDefined();
    });

    it('merges user ignorePaths on top of the defaults', async () => {
      const { middleware, cls } = await createMiddleware({ ignorePaths: ['/health'] });

      const health = await runMiddleware(
        middleware,
        { method: 'GET', url: '/health', path: '/health', headers: {}, query: {} },
        cls,
      );
      const favicon = await runMiddleware(
        middleware,
        { method: 'GET', url: '/favicon.ico', path: '/favicon.ico', headers: {}, query: {} },
        cls,
      );

      expect(health).toBeUndefined();
      expect(favicon).toBeUndefined();
    });
  });

  describe('finish hook (safety net for direct-response frameworks)', () => {
    /**
     * Creates a response mock that supports the finish event mechanism
     * (mimics the Express ServerResponse EventEmitter interface).
     */
    function makeResWithFinish(statusCode = 200): PlatformResponse & {
      triggerFinish(): void;
      json: jest.Mock;
      send: jest.Mock;
      statusCode: number;
    } {
      const stored: Record<string, string | string[]> = {};
      let finishListener: (() => void) | undefined;
      const jsonMock = jest.fn();
      const sendMock = jest.fn();

      return {
        statusCode,
        setHeader(k: string, v: string | string[]) {
          stored[k] = v;
        },
        getHeader(k: string) {
          return stored[k];
        },
        getHeaders() {
          return stored;
        },
        once(event: string, fn: () => void) {
          if (event === 'finish') finishListener = fn;
        },
        json: jsonMock,
        send: sendMock,
        triggerFinish() {
          finishListener?.();
        },
      } as Partial<PlatformResponse> & {
        triggerFinish(): void;
        json: jest.Mock;
        send: jest.Mock;
        statusCode: number;
      } as PlatformResponse & {
        triggerFinish(): void;
        json: jest.Mock;
        send: jest.Mock;
        statusCode: number;
      };
    }

    interface CoreMockForMiddleware {
      enrichHttpResponse: jest.Mock;
      collectorRegistry: { collectAll: jest.Mock };
      storage: { save: jest.Mock };
      schedulePersist: jest.Mock;
      scheduleSave: jest.Mock;
    }

    function makeCoreMock(): CoreMockForMiddleware {
      const core: CoreMockForMiddleware = {
        enrichHttpResponse: jest.fn(),
        collectorRegistry: { collectAll: jest.fn().mockResolvedValue(undefined) },
        storage: { save: jest.fn() },
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

    function createMiddlewareWithCore(options: ProfilerModuleOptions = {}): {
      middleware: ProfilerMiddleware;
      cls: ClsService;
      coreMock: CoreMockForMiddleware;
    } {
      const coreMock = makeCoreMock();
      const clsLike = {
        run: (fn: () => void) => fn(),
        set: jest.fn(),
        get: jest.fn(() => undefined),
      } as object as ClsService;
      const middleware = new ProfilerMiddleware(
        clsLike,
        options,
        coreMock as object as ProfilerCoreService,
      );
      return { middleware, cls: clsLike, coreMock };
    }

    const makeReq = (path = '/api') =>
      ({
        method: 'POST',
        url: path,
        headers: {},
        query: {},
      }) as Partial<PlatformRequest> as PlatformRequest;

    const waitAsync = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));

    const runMw = (mw: ProfilerMiddleware, res: PlatformResponse, path = '/api') =>
      new Promise<void>((resolve) => {
        mw.use(makeReq(path), res, () => resolve());
      });

    it('saves profile via finish hook when profile.response is not set', async () => {
      const { middleware, coreMock } = createMiddlewareWithCore();
      const res = makeResWithFinish(400);
      await runMw(middleware, res);

      res.triggerFinish();
      await waitAsync();

      expect(coreMock.storage.save).toHaveBeenCalled();
      const saved = (coreMock.storage.save.mock.calls as [Profile][]).at(0)?.[0];
      expect(saved?.response?.statusCode).toBe(400);
    });

    it('measures the request duration on the monotonic clock, not the wall clock', async () => {
      const { middleware, coreMock } = createMiddlewareWithCore();
      const res = makeResWithFinish(200);
      await runMw(middleware, res);

      // The wall clock steps a minute backwards before the response finishes. The old
      // `Date.now() - startTime` arithmetic produced a duration of about -60000 here.
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() - 60_000);
      res.triggerFinish();
      await waitAsync();
      jest.restoreAllMocks();

      const saved = (coreMock.storage.save.mock.calls as [Profile][]).at(0)?.[0];
      expect(saved?.performance.duration).toBeGreaterThanOrEqual(0);
      expect(saved?.performance.duration).toBeLessThan(10_000);
    });

    it('reads the clock once, so createdAt and startTime name the same instant', async () => {
      const { middleware, coreMock } = createMiddlewareWithCore();
      const res = makeResWithFinish(200);
      await runMw(middleware, res);

      res.triggerFinish();
      await waitAsync();

      const saved = (coreMock.storage.save.mock.calls as [Profile][]).at(0)?.[0];
      expect(saved?.createdAt).toBe(saved?.performance.startTime);
    });

    it('skips finish hook when profile.response is already set (normal path ran)', async () => {
      const { middleware, coreMock } = createMiddlewareWithCore();
      const res = makeResWithFinish();
      await runMw(middleware, res);

      res.triggerFinish();
      await waitAsync(5);

      const saved = (coreMock.storage.save.mock.calls as [Profile][]).at(0)?.[0];
      if (saved) saved.response = { statusCode: 200, headers: {}, body: undefined };

      const callsBefore = coreMock.storage.save.mock.calls.length;
      res.triggerFinish();
      await waitAsync(5);

      expect(coreMock.storage.save.mock.calls.length).toBe(callsBefore);
    });

    it('intercepts res.json() and calls enrichHttpResponse with response body', async () => {
      const { middleware, coreMock } = createMiddlewareWithCore({ collectBody: true });
      const res = makeResWithFinish(400);
      await runMw(middleware, res, '/graphql');

      const gqlResponse = { errors: [{ message: 'bad field' }] };
      res.json(gqlResponse);
      res.triggerFinish();
      await waitAsync();

      expect(coreMock.enrichHttpResponse).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        gqlResponse,
      );
    });

    it('intercepts res.send() with a JSON string and parses it', async () => {
      const { middleware, coreMock } = createMiddlewareWithCore({ collectBody: true });
      const res = makeResWithFinish(400);
      await runMw(middleware, res, '/graphql');

      res.send(JSON.stringify({ errors: [{ message: 'bad field' }] }));
      res.triggerFinish();
      await waitAsync();

      expect(coreMock.enrichHttpResponse).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        { errors: [{ message: 'bad field' }] },
      );
    });

    it('handles non-JSON string in res.send() — falls back to raw value', async () => {
      const { middleware, coreMock } = createMiddlewareWithCore({ collectBody: true });
      const res = makeResWithFinish(200);
      await runMw(middleware, res);

      res.send('plain text');
      res.triggerFinish();
      await waitAsync();

      expect(coreMock.storage.save).toHaveBeenCalled();
    });

    it('only captures first response body (captureBody is idempotent)', async () => {
      const { middleware, coreMock } = createMiddlewareWithCore({ collectBody: true });
      const res = makeResWithFinish(200);
      await runMw(middleware, res);

      res.json({ first: true });
      res.json({ second: true });
      res.triggerFinish();
      await waitAsync();

      expect(coreMock.enrichHttpResponse).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        { first: true },
      );
    });

    it('does not store body in profile.response when collectBody is false', async () => {
      const { middleware, coreMock } = createMiddlewareWithCore({ collectBody: false });
      const res = makeResWithFinish(400);
      await runMw(middleware, res, '/graphql');

      res.json({ errors: [{ message: 'err' }] });
      res.triggerFinish();
      await waitAsync();

      const saved = (coreMock.storage.save.mock.calls as [Profile][]).at(0)?.[0];
      expect(saved?.response?.body).toBeUndefined();
    });

    /** Reads the live profile the middleware created (captured via cls.set). */
    const capturedProfile = (cls: ClsService): Profile<HttpRequestData> => {
      const calls = (cls as unknown as { set: jest.Mock }).set.mock.calls as [string, unknown][];
      return calls.find((c) => c[0] === 'profiler.profile')?.[1] as Profile<HttpRequestData>;
    };

    it('backfills the GraphQL transport envelope into an already-finalized response', async () => {
      // Mirrors GraphQL over HTTP: the interceptor finalized in the resolver (non-HTTP)
      // context with no body, then the driver wrote the { data, errors } envelope.
      const { middleware, cls, coreMock } = createMiddlewareWithCore({ collectBody: true });
      const res = makeResWithFinish(200);
      await runMw(middleware, res, '/graphql');

      const profile = capturedProfile(cls);
      profile.entrypoint.data.graphql = {
        operationType: 'mutation',
        fieldName: 'createBook',
      };
      profile.response = { statusCode: 500, headers: {}, body: undefined };

      const envelope = { errors: [{ message: 'boom' }], data: null };
      res.json(envelope);
      res.triggerFinish();
      await waitAsync();

      expect(profile.response.body).toEqual(envelope);
      // The real transport status replaces the interceptor's placeholder 500.
      expect(profile.response.statusCode).toBe(200);
      expect(coreMock.storage.save).toHaveBeenCalledWith(profile);
    });

    it('leaves an already-finalized non-GraphQL response untouched', async () => {
      const { middleware, cls, coreMock } = createMiddlewareWithCore({ collectBody: true });
      const res = makeResWithFinish(200);
      await runMw(middleware, res, '/api');

      const profile = capturedProfile(cls);
      profile.response = { statusCode: 201, headers: {}, body: { original: true } };

      res.json({ other: true });
      const callsBefore = coreMock.storage.save.mock.calls.length;
      res.triggerFinish();
      await waitAsync();

      expect(profile.response.body).toEqual({ original: true });
      expect(coreMock.storage.save.mock.calls.length).toBe(callsBefore);
    });

    it('backfills the error-response body written by an exception filter', async () => {
      // catchError finalized with an undefined body; the exception filter then wrote res.json().
      const { middleware, cls, coreMock } = createMiddlewareWithCore({ collectBody: true });
      const res = makeResWithFinish(400);
      await runMw(middleware, res, '/api');

      const profile = capturedProfile(cls);
      profile.exceptions.push({
        name: 'BadRequestException',
        message: 'bad',
        timestamp: Date.now(),
      });
      profile.response = { statusCode: 400, headers: {}, body: undefined };

      const errorBody = { errors: 'validation failed' };
      res.json(errorBody);
      res.triggerFinish();
      await waitAsync();

      expect(profile.response.body).toEqual(errorBody);
      expect(profile.response.statusCode).toBe(400);
      expect(coreMock.storage.save).toHaveBeenCalledWith(profile);
    });

    it('does not backfill an error-response body when collectBody is false', async () => {
      const { middleware, cls, coreMock } = createMiddlewareWithCore({ collectBody: false });
      const res = makeResWithFinish(400);
      await runMw(middleware, res, '/api');

      const profile = capturedProfile(cls);
      profile.exceptions.push({
        name: 'BadRequestException',
        message: 'bad',
        timestamp: Date.now(),
      });
      profile.response = { statusCode: 400, headers: {}, body: undefined };

      res.json({ errors: 'validation failed' });
      const callsBefore = coreMock.storage.save.mock.calls.length;
      res.triggerFinish();
      await waitAsync();

      expect(profile.response.body).toBeUndefined();
      expect(coreMock.storage.save.mock.calls.length).toBe(callsBefore);
    });

    /** Raw Node-style response: no json()/send(), body written via write()+end(). */
    function makeRawResWithFinish(contentType = 'application/json'): PlatformResponse & {
      triggerFinish(): void;
      write: (chunk: unknown) => boolean;
      end: (chunk?: unknown) => void;
      statusCode: number;
    } {
      const stored: Record<string, string | string[]> = { 'content-type': contentType };
      let finishListener: (() => void) | undefined;
      return {
        statusCode: 200,
        setHeader(k: string, v: string | string[]) {
          stored[k] = v;
        },
        getHeader(k: string) {
          return stored[k];
        },
        getHeaders() {
          return stored;
        },
        once(event: string, fn: () => void) {
          if (event === 'finish') finishListener = fn;
        },
        write: jest.fn(() => true),
        end: jest.fn(),
        triggerFinish() {
          finishListener?.();
        },
      } as object as PlatformResponse & {
        triggerFinish(): void;
        write: (chunk: unknown) => boolean;
        end: (chunk?: unknown) => void;
        statusCode: number;
      };
    }

    it('captures the body from write()+end() when the framework bypasses json()/send()', async () => {
      const { middleware, coreMock } = createMiddlewareWithCore({ collectBody: true });
      const res = makeRawResWithFinish();
      await runMw(middleware, res, '/graphql');

      const envelope = { errors: [{ message: 'mercurius boom' }], data: null };
      res.write(Buffer.from(JSON.stringify(envelope)));
      res.end(); // Fastify ends with no body of its own
      res.triggerFinish();
      await waitAsync();

      expect(coreMock.enrichHttpResponse).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        envelope,
      );
    });

    it('captures a body passed directly to end()', async () => {
      const { middleware, coreMock } = createMiddlewareWithCore({ collectBody: true });
      const res = makeRawResWithFinish();
      await runMw(middleware, res, '/graphql');

      res.end(JSON.stringify({ data: { ok: true } }));
      res.triggerFinish();
      await waitAsync();

      expect(coreMock.enrichHttpResponse).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        {
          data: { ok: true },
        },
      );
    });

    it('does not buffer write() chunks for non-JSON responses', async () => {
      const { middleware, coreMock } = createMiddlewareWithCore({ collectBody: true });
      const res = makeRawResWithFinish('text/html');
      await runMw(middleware, res, '/page');

      res.write('<html>');
      res.write('</html>');
      res.end();
      res.triggerFinish();
      await waitAsync();

      const saved = (coreMock.storage.save.mock.calls as [Profile][]).at(0)?.[0];
      expect(saved?.response?.body).toBeUndefined();
    });

    it('does not buffer write() chunks for non-GraphQL requests when collectBody is off', async () => {
      const { middleware, coreMock } = createMiddlewareWithCore({ collectBody: false });
      const res = makeRawResWithFinish();
      await runMw(middleware, res, '/api');

      res.write(Buffer.from(JSON.stringify({ data: { ok: true } })));
      res.end();
      res.triggerFinish();
      await waitAsync();

      expect(coreMock.enrichHttpResponse).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        undefined,
      );
    });

    it('abandons buffering once the response exceeds the size cap', async () => {
      const { middleware, coreMock } = createMiddlewareWithCore({ collectBody: true });
      const res = makeRawResWithFinish();
      await runMw(middleware, res, '/graphql');

      // Two chunks that together exceed 1 MB — far larger than any GraphQL envelope.
      res.write(Buffer.alloc(600 * 1024, 0x7b)); // '{'
      res.write(Buffer.alloc(600 * 1024, 0x7d)); // '}'
      res.end();
      res.triggerFinish();
      await waitAsync();

      const saved = (coreMock.storage.save.mock.calls as [Profile][]).at(0)?.[0];
      expect(saved?.response?.body).toBeUndefined();
    });
  });
});

/**
 * Builds a `ProfilerMiddleware` with a real, working `ClsService` (backed by a genuine
 * `AsyncLocalStorage`, as `nestjs-cls` requires) but without going through
 * `Test.createTestingModule` — plain construction, like `createMiddlewareWithCore` above uses
 * for its own stub. Keeps this file's already-heavy compile count (~35 `Test.createTestingModule`
 * calls) from growing further.
 */
function createStandaloneMiddleware(options: ProfilerModuleOptions = {}): {
  middleware: ProfilerMiddleware;
  cls: ClsService;
} {
  const cls = new ClsService(new AsyncLocalStorage());
  const middleware = new ProfilerMiddleware(
    cls,
    options,
    undefined as unknown as ProfilerCoreService,
  );
  return { middleware, cls };
}

describe('ProfilerMiddleware — redaction block', () => {
  it('merges redaction.headers with the deprecated maskHeaders, both additive over the defaults', async () => {
    const { middleware, cls } = createStandaloneMiddleware({
      maskHeaders: ['x-legacy'],
      redaction: { headers: ['x-trace'] },
    });

    const profile = await runMiddleware(
      middleware,
      {
        method: 'GET',
        url: '/x',
        headers: { authorization: 'Bearer t', 'x-legacy': 'a', 'x-trace': 'b', 'x-plain': 'c' },
        query: {},
      },
      cls,
    );

    expect(reqData(profile)?.headers).toEqual({
      authorization: '[REDACTED]',
      'x-legacy': '[REDACTED]',
      'x-trace': '[REDACTED]',
      'x-plain': 'c',
    });
  });

  it('merges redaction.cookies with the deprecated maskCookies', async () => {
    const { middleware, cls } = createStandaloneMiddleware({
      maskCookies: ['old_token'],
      redaction: { cookies: ['new_token'] },
    });

    const profile = await runMiddleware(
      middleware,
      {
        method: 'GET',
        url: '/x',
        headers: {},
        query: {},
        cookies: { old_token: 'a', new_token: 'b', kept: 'c' },
      },
      cls,
    );

    expect(reqData(profile)?.cookies).toEqual({
      old_token: '[REDACTED]',
      new_token: '[REDACTED]',
      kept: 'c',
    });
  });

  it('drops the built-in defaults when redaction.useDefaults is false, keeping only the explicit lists', async () => {
    const { middleware, cls } = createStandaloneMiddleware({
      redaction: { useDefaults: false, headers: ['x-only-this'] },
    });

    const profile = await runMiddleware(
      middleware,
      {
        method: 'GET',
        url: '/x',
        headers: { authorization: 'Bearer t', 'x-only-this': 'a' },
        query: {},
      },
      cls,
    );

    expect(reqData(profile)?.headers).toEqual({
      authorization: 'Bearer t',
      'x-only-this': '[REDACTED]',
    });
  });

  it('applies a custom replacement sentinel to headers, query params and session data', async () => {
    const { middleware, cls } = createStandaloneMiddleware({
      redaction: { replacement: '***' },
    });

    const profile = await runMiddleware(
      middleware,
      {
        method: 'GET',
        url: '/x?token=secret',
        headers: { authorization: 'Bearer t' },
        query: { token: 'secret' },
        session: { password: 'hunter2' },
      },
      cls,
    );

    expect(reqData(profile)?.headers?.authorization).toBe('***');
    expect(reqData(profile)?.query).toEqual({ token: '***' });
    expect(reqData(profile)?.url).toBe('/x?token=***');
    expect(reqData(profile)?.session).toEqual({ password: '***' });
  });

  it('masks object keys via redaction.keys in captured session data', async () => {
    const { middleware, cls } = createStandaloneMiddleware({
      redaction: { keys: ['internalToken'] },
    });

    const profile = await runMiddleware(
      middleware,
      {
        method: 'GET',
        url: '/x',
        headers: {},
        query: {},
        session: { internalToken: 'secret', name: 'bob' },
      },
      cls,
    );

    expect(reqData(profile)?.session).toEqual({ internalToken: '[REDACTED]', name: 'bob' });
  });
});

describe('ProfilerMiddleware — body redaction', () => {
  it('redacts sensitive keys inside a captured request body', async () => {
    const { middleware, cls } = createStandaloneMiddleware({ collectBody: true });

    const profile = await runMiddleware(
      middleware,
      {
        method: 'POST',
        url: '/login',
        headers: {},
        query: {},
        body: { email: 'a@b.c', password: 'hunter2' },
      },
      cls,
    );

    expect(reqData(profile)?.body).toEqual({ email: 'a@b.c', password: '[REDACTED]' });
  });

  it('extends body key masking through redaction.keys', async () => {
    const { middleware, cls } = createStandaloneMiddleware({
      collectBody: true,
      redaction: { keys: ['tenantRef'] },
    });

    const profile = await runMiddleware(
      middleware,
      {
        method: 'POST',
        url: '/x',
        headers: {},
        query: {},
        body: { tenantRef: 'acme-42', kept: 'value' },
      },
      cls,
    );

    expect(reqData(profile)?.body).toEqual({ tenantRef: '[REDACTED]', kept: 'value' });
  });
});

describe('ProfilerMiddleware — attributes option', () => {
  it('stamps a function-form attributes option onto profile.attributes', async () => {
    const { middleware, cls } = createStandaloneMiddleware({
      attributes: (req) => ({ tenant: req.headers['x-tenant-id'] as string }),
    });

    const profile = await runMiddleware(
      middleware,
      { method: 'GET', url: '/x', headers: { 'x-tenant-id': 'acme' }, query: {} },
      cls,
    );

    expect(profile?.attributes).toEqual({ tenant: 'acme' });
  });

  it('leaves profile.attributes undefined when attributes is a static object (handled by the core service instead)', async () => {
    const { middleware, cls } = createStandaloneMiddleware({ attributes: { env: 'staging' } });

    const profile = await runMiddleware(
      middleware,
      { method: 'GET', url: '/x', headers: {}, query: {} },
      cls,
    );

    expect(profile?.attributes).toBeUndefined();
  });
});

describe('ProfilerMiddleware — alwaysProfile', () => {
  it('forces capture past a sampleRate that would otherwise skip', async () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      const { middleware, cls } = createStandaloneMiddleware({
        sampleRate: 0.1,
        alwaysProfile: (req) => req.headers['x-profiler'] === '1',
      });

      const profile = await runMiddleware(
        middleware,
        { method: 'GET', url: '/x', headers: { 'x-profiler': '1' }, query: {} },
        cls,
      );

      expect(profile).toBeDefined();
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('does not resurrect a request excluded by ignorePaths', async () => {
    const { middleware, cls } = createStandaloneMiddleware({
      ignorePaths: ['/health'],
      alwaysProfile: () => true,
    });

    const profile = await runMiddleware(
      middleware,
      { method: 'GET', url: '/health/live', path: '/health/live', headers: {}, query: {} },
      cls,
    );

    expect(profile).toBeUndefined();
  });

  it('still applies the sampleRate roll for a request alwaysProfile does not match', async () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      const { middleware, cls } = createStandaloneMiddleware({
        sampleRate: 0.1,
        alwaysProfile: (req) => req.headers['x-profiler'] === '1',
      });

      const profile = await runMiddleware(
        middleware,
        { method: 'GET', url: '/x', headers: {}, query: {} },
        cls,
      );

      expect(profile).toBeUndefined();
    } finally {
      randomSpy.mockRestore();
    }
  });
});

describe('ProfilerMiddleware — debug option', () => {
  it('logs the skip reason when debug is enabled and ignoreRequest excludes a request', async () => {
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    try {
      const { middleware, cls } = createStandaloneMiddleware({
        debug: true,
        ignoreRequest: () => true,
      });

      await runMiddleware(middleware, { method: 'GET', url: '/x', headers: {}, query: {} }, cls);

      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('ignoreRequest'));
    } finally {
      debugSpy.mockRestore();
    }
  });

  it("logs the profiler's own route, the one skip a reader is most likely to be looking for", async () => {
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    try {
      const { middleware, cls } = createStandaloneMiddleware({ debug: true });

      await runMiddleware(
        middleware,
        { method: 'GET', url: '/_profiler/abc', path: '/_profiler/abc', headers: {}, query: {} },
        cls,
      );

      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("profiler's own route"));
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('stays silent when debug is left off (default)', async () => {
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    try {
      const { middleware, cls } = createStandaloneMiddleware({ ignoreRequest: () => true });

      await runMiddleware(middleware, { method: 'GET', url: '/x', headers: {}, query: {} }, cls);

      expect(debugSpy).not.toHaveBeenCalled();
    } finally {
      debugSpy.mockRestore();
    }
  });
});
