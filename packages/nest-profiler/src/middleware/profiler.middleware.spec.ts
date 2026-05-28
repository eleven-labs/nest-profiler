import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { ProfilerMiddleware } from './profiler.middleware';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { Profile } from '../interfaces/profile.interface';
import type { PlatformRequest, PlatformResponse } from '../types/http';

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
): Promise<Profile | undefined> {
  return new Promise<Profile | undefined>((resolve) => {
    const next = () => {
      try {
        resolve(cls.get<Profile | undefined>('profiler.profile'));
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
      expect(profile?.request.url).toBe('/users?page=2');
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

      expect(profile?.request.cookies).toEqual({ session_id: 'abc123', theme: 'dark' });
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

      expect(profile?.request.cookies?.['auth_token']).toBe('***');
      expect(profile?.request.cookies?.['user_id']).toBe('42');
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

      expect(profile?.request.session).toEqual({ userId: 7, role: 'admin' });
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
      expect(profile?.request.url).toBe('/products');
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

      expect(profile?.request.cookies).toEqual({ session_id: 'xyz', theme: 'light' });
    });

    it('has no cookies field when neither req.cookies nor Cookie header are present', async () => {
      const profile = await runMiddleware(
        middleware,
        { method: 'GET', url: '/products', headers: {}, query: {} },
        cls,
      );

      expect(profile?.request.cookies).toBeUndefined();
    });

    it('has no session field when req.session is absent', async () => {
      const profile = await runMiddleware(
        middleware,
        { method: 'GET', url: '/products', headers: {}, query: {} },
        cls,
      );

      expect(profile?.request.session).toBeUndefined();
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

      expect(profile?.request.ip).toBe('192.168.1.1');
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

      expect(profile?.request.body).toEqual({ title: 'Hello' });
    });

    it('does not capture body when collectBody is false (default)', async () => {
      const profile = await runMiddleware(
        middleware,
        { method: 'POST', url: '/posts', headers: {}, query: {}, body: { title: 'Hello' } },
        cls,
      );

      expect(profile?.request.body).toBeUndefined();
    });

    it('uses the x-request-id header as the token when present', async () => {
      const profile = await runMiddleware(
        middleware,
        { method: 'GET', url: '/p', headers: { 'x-request-id': 'req-123' }, query: {} },
        cls,
      );
      expect(profile?.token).toBe('req-123');
    });

    it('uses the first value when x-request-id is an array', async () => {
      const profile = await runMiddleware(
        middleware,
        { method: 'GET', url: '/p', headers: { 'x-request-id': ['req-a', 'req-b'] }, query: {} },
        cls,
      );
      expect(profile?.token).toBe('req-a');
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
      expect(profile?.request.session).toEqual({ userId: 1 });
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
      expect(profile?.request.session).toBeUndefined();
    });

    it('skips malformed cookie segments without an "=" separator', async () => {
      const profile = await runMiddleware(
        middleware,
        { method: 'GET', url: '/p', headers: { cookie: 'flag; a=b' }, query: {} },
        cls,
      );
      expect(profile?.request.cookies).toEqual({ a: 'b' });
    });
  });
});
