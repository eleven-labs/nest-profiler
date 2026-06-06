import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ProfilerGuard } from './profiler.guard';

function makeCtx(authHeader?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authHeader ? { authorization: authHeader } : {},
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
});
