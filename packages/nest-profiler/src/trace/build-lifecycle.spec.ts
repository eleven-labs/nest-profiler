import { buildLifecycle, lifecycleMarks } from './build-lifecycle';
import type { Profile } from '../interfaces/profile.interface';

function makeProfile(durationMs = 100): Profile {
  return {
    token: 't',
    createdAt: 0,
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: 1000, duration: durationMs, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

describe('lifecycleMarks', () => {
  it('returns the same mutable holder on repeated access', () => {
    const profile = makeProfile();
    lifecycleMarks(profile).guardsAt = 5;
    expect(lifecycleMarks(profile).guardsAt).toBe(5);
  });

  it('does not serialize onto the profile (Symbol key)', () => {
    const profile = makeProfile();
    lifecycleMarks(profile).controllerAt = 7;
    const serialized = JSON.parse(JSON.stringify(profile)) as Partial<Profile>;
    expect(serialized.lifecycle).toBeUndefined();
    expect(Object.getOwnPropertySymbols(profile)).toHaveLength(1);
  });
});

describe('buildLifecycle', () => {
  it('does nothing when no marks were captured', () => {
    const profile = makeProfile();
    buildLifecycle(profile);
    expect(profile.lifecycle).toBeUndefined();
  });

  it('assembles guards and controller from the marks and the request duration', () => {
    const profile = makeProfile(100); // window: 1000 → 1100
    const marks = lifecycleMarks(profile);
    marks.guardsAt = 1002;
    marks.controllerAt = 1005;
    buildLifecycle(profile);
    expect(profile.lifecycle).toEqual([
      { name: 'guards', startedAt: 1002, duration: 3 },
      { name: 'controller', startedAt: 1005, duration: 95 },
    ]);
  });

  it('adds an aggregated validation phase between guards and controller, ordered by start', () => {
    const profile = makeProfile(100);
    const marks = lifecycleMarks(profile);
    marks.guardsAt = 1001;
    marks.controllerAt = 1004;
    marks.validationStart = 1010;
    marks.validationEnd = 1013;
    buildLifecycle(profile);
    expect(profile.lifecycle?.map((p) => p.name)).toEqual(['guards', 'controller', 'validation']);
    expect(profile.lifecycle?.find((p) => p.name === 'validation')).toEqual({
      name: 'validation',
      startedAt: 1010,
      duration: 3,
    });
  });

  it('spans guards to the request end when a guard short-circuits (no controller ran)', () => {
    const profile = makeProfile(20); // window 1000 → 1020
    lifecycleMarks(profile).guardsAt = 1002;
    buildLifecycle(profile);
    expect(profile.lifecycle).toEqual([{ name: 'guards', startedAt: 1002, duration: 18 }]);
  });

  it('emits only controller when guards were not stamped (e.g. Apollo path)', () => {
    const profile = makeProfile(50);
    lifecycleMarks(profile).controllerAt = 1000;
    buildLifecycle(profile);
    expect(profile.lifecycle).toEqual([{ name: 'controller', startedAt: 1000, duration: 50 }]);
  });

  it('drops phases too fast to measure (0 ms), e.g. a guard-less route', () => {
    const profile = makeProfile(10); // window 1000 → 1010
    const marks = lifecycleMarks(profile);
    marks.guardsAt = 1000; // no real guard: guards ≈ controller start → 0 ms
    marks.controllerAt = 1000;
    buildLifecycle(profile);
    // Only the 10 ms controller survives; the 0 ms guards phase is dropped.
    expect(profile.lifecycle).toEqual([{ name: 'controller', startedAt: 1000, duration: 10 }]);
  });

  it('skips guards/controller for a non-HTTP entrypoint (e.g. GraphQL), keeping only validation', () => {
    const profile = makeProfile(100);
    profile.entrypoint = { type: 'graphql', data: {} };
    const marks = lifecycleMarks(profile);
    marks.guardsAt = 1002; // per-resolver guard — would otherwise stretch to the request end
    marks.validationStart = 1010;
    marks.validationEnd = 1015;
    buildLifecycle(profile);
    expect(profile.lifecycle).toEqual([{ name: 'validation', startedAt: 1010, duration: 5 }]);
  });

  it('sets no lifecycle at all when every phase is below measurement resolution', () => {
    const profile = makeProfile(0);
    lifecycleMarks(profile).controllerAt = 1000;
    buildLifecycle(profile);
    expect(profile.lifecycle).toBeUndefined();
  });
});
