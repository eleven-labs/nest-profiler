import { ClsService } from 'nestjs-cls';
import { ProfilerLifecycleGuard } from './profiler-lifecycle.guard';
import { lifecycleMarks } from '../trace/build-lifecycle';
import { PROFILER_CLS_KEYS } from '../constants';
import type { Profile } from '../interfaces/profile.interface';

function makeProfile(): Profile {
  return {
    token: 't',
    createdAt: 0,
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: 0, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

function clsReturning(profile: Profile | undefined, throws = false): ClsService {
  return {
    get: (key: string) => {
      if (throws) throw new Error('outside CLS');
      return key === PROFILER_CLS_KEYS.profile ? profile : undefined;
    },
  } as unknown as ClsService;
}

describe('ProfilerLifecycleGuard', () => {
  it('always allows the request', () => {
    expect(new ProfilerLifecycleGuard(clsReturning(makeProfile())).canActivate()).toBe(true);
  });

  it('stamps the guards start on the active profile (first call wins)', () => {
    const profile = makeProfile();
    const guard = new ProfilerLifecycleGuard(clsReturning(profile));
    guard.canActivate();
    const first = lifecycleMarks(profile).guardsAt;
    expect(typeof first).toBe('number');
    guard.canActivate();
    expect(lifecycleMarks(profile).guardsAt).toBe(first);
  });

  it('is a safe no-op with no active profile or outside a CLS context', () => {
    expect(new ProfilerLifecycleGuard(clsReturning(undefined)).canActivate()).toBe(true);
    expect(new ProfilerLifecycleGuard(clsReturning(undefined, true)).canActivate()).toBe(true);
  });
});
