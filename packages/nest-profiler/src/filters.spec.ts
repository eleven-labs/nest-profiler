import { combineFilters } from './filters';
import type { ProfilerFilterRequest, ProfilerRequestFilter } from './filters';

function req(overrides: Partial<ProfilerFilterRequest> = {}): ProfilerFilterRequest {
  return { method: 'GET', url: '/health', headers: {}, ...overrides };
}

describe('combineFilters', () => {
  it('returns false when all filters return false', () => {
    const never: ProfilerRequestFilter = () => false;
    expect(combineFilters(never, never)(req())).toBe(false);
  });

  it('returns true when any filter returns true', () => {
    const never: ProfilerRequestFilter = () => false;
    const always: ProfilerRequestFilter = () => true;
    expect(combineFilters(never, always, never)(req())).toBe(true);
  });

  it('short-circuits on the first match', () => {
    const calls: string[] = [];
    const f1: ProfilerRequestFilter = () => {
      calls.push('f1');
      return true;
    };
    const f2: ProfilerRequestFilter = () => {
      calls.push('f2');
      return false;
    };
    combineFilters(f1, f2)(req());
    expect(calls).toEqual(['f1']); // f2 never called
  });

  it('works with a single filter', () => {
    const alwaysTrue: ProfilerRequestFilter = () => true;
    expect(combineFilters(alwaysTrue)(req())).toBe(true);
  });

  it('passes the request object to each filter', () => {
    const received: ProfilerFilterRequest[] = [];
    const capture: ProfilerRequestFilter = (r) => {
      received.push(r);
      return false;
    };
    const target = req({ method: 'POST', url: '/graphql' });
    combineFilters(capture)(target);
    expect(received[0]).toBe(target);
  });
});
