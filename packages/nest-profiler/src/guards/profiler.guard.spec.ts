import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ProfilerGuard } from './profiler.guard';

function makeCtx(
  authHeader?: string,
  extras: { url?: string; query?: Record<string, string | string[]> } = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authHeader ? { authorization: authHeader } : {},
        url: extras.url,
        query: extras.query,
      }),
    }),
  } as Partial<ExecutionContext> as ExecutionContext;
}

describe('ProfilerGuard', () => {
  const originalEnv = process.env['PROFILER_TOKEN'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['PROFILER_TOKEN'];
    } else {
      process.env['PROFILER_TOKEN'] = originalEnv;
    }
  });

  describe('env-based token (no module options)', () => {
    let guard: ProfilerGuard;

    beforeEach(() => {
      guard = new ProfilerGuard();
    });

    it('allows access when PROFILER_TOKEN is not set', () => {
      delete process.env['PROFILER_TOKEN'];
      expect(guard.canActivate(makeCtx())).toBe(true);
    });

    it('allows access with valid Bearer token', () => {
      process.env['PROFILER_TOKEN'] = 'mysecret';
      expect(guard.canActivate(makeCtx('Bearer mysecret'))).toBe(true);
    });

    it('throws UnauthorizedException with wrong token', () => {
      process.env['PROFILER_TOKEN'] = 'mysecret';
      expect(() => guard.canActivate(makeCtx('Bearer wrong'))).toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException with no header when token is required', () => {
      process.env['PROFILER_TOKEN'] = 'mysecret';
      expect(() => guard.canActivate(makeCtx())).toThrow(UnauthorizedException);
    });
  });

  describe('option-based token', () => {
    it('allows access with valid Bearer token from module options', () => {
      delete process.env['PROFILER_TOKEN'];
      const guard = new ProfilerGuard({ token: 'optsecret' });
      expect(guard.canActivate(makeCtx('Bearer optsecret'))).toBe(true);
    });

    it('throws UnauthorizedException with wrong token from module options', () => {
      delete process.env['PROFILER_TOKEN'];
      const guard = new ProfilerGuard({ token: 'optsecret' });
      expect(() => guard.canActivate(makeCtx('Bearer wrong'))).toThrow(UnauthorizedException);
    });

    it('takes precedence over the PROFILER_TOKEN environment variable', () => {
      process.env['PROFILER_TOKEN'] = 'envsecret';
      const guard = new ProfilerGuard({ token: 'optsecret' });
      expect(guard.canActivate(makeCtx('Bearer optsecret'))).toBe(true);
      expect(() => guard.canActivate(makeCtx('Bearer envsecret'))).toThrow(UnauthorizedException);
    });

    it('falls back to PROFILER_TOKEN env var when options omit a token', () => {
      process.env['PROFILER_TOKEN'] = 'envsecret';
      const guard = new ProfilerGuard({});
      expect(guard.canActivate(makeCtx('Bearer envsecret'))).toBe(true);
    });
  });

  describe('browser access (MAJ-4)', () => {
    beforeEach(() => delete process.env['PROFILER_TOKEN']);

    it('accepts the token from the ?token= query parameter', () => {
      const guard = new ProfilerGuard({ token: 'optsecret' });
      expect(guard.canActivate(makeCtx(undefined, { query: { token: 'optsecret' } }))).toBe(true);
    });

    it('rejects a wrong query-param token', () => {
      const guard = new ProfilerGuard({ token: 'optsecret' });
      expect(() => guard.canActivate(makeCtx(undefined, { query: { token: 'nope' } }))).toThrow(
        UnauthorizedException,
      );
    });

    it('exempts static assets so the UI can always load its CSS/JS', () => {
      const guard = new ProfilerGuard({ token: 'optsecret' });
      expect(
        guard.canActivate(makeCtx(undefined, { url: '/_profiler/__assets/styles/toolbar.css' })),
      ).toBe(true);
    });

    it('still protects HTML pages when no token is provided', () => {
      const guard = new ProfilerGuard({ token: 'optsecret' });
      expect(() => guard.canActivate(makeCtx(undefined, { url: '/_profiler' }))).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token of a different length (constant-time compare guards length)', () => {
      const guard = new ProfilerGuard({ token: 'optsecret' });
      expect(() => guard.canActivate(makeCtx('Bearer short'))).toThrow(UnauthorizedException);
    });
  });
});
