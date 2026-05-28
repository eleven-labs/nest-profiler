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
  let guard: ProfilerGuard;
  const originalEnv = process.env['PROFILER_TOKEN'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['PROFILER_TOKEN'];
    } else {
      process.env['PROFILER_TOKEN'] = originalEnv;
    }
  });

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
