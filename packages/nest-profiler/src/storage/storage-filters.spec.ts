import { applyProfileFilters } from './storage-filters';
import type { Profile } from '../interfaces/profile.interface';

function makeProfile(overrides: {
  method?: string;
  url?: string;
  statusCode?: number;
  duration?: number;
}): Profile {
  return {
    token: Math.random().toString(36).slice(2),
    createdAt: Date.now(),
    request: {
      method: overrides.method ?? 'GET',
      url: overrides.url ?? '/',
      headers: {},
      query: {},
    },
    response:
      overrides.statusCode !== undefined
        ? { statusCode: overrides.statusCode, headers: {} }
        : undefined,
    performance: { startTime: 0, heapUsed: 0, duration: overrides.duration },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

describe('applyProfileFilters', () => {
  const profiles = [
    makeProfile({ method: 'GET', url: '/users', statusCode: 200, duration: 10 }),
    makeProfile({ method: 'POST', url: '/orders', statusCode: 500, duration: 100 }),
    makeProfile({ method: 'GET', url: '/Users/42', statusCode: 404, duration: 50 }),
  ];

  it('returns the input unchanged when no options are provided', () => {
    expect(applyProfileFilters(profiles)).toBe(profiles);
  });

  it('filters by method case-insensitively', () => {
    const result = applyProfileFilters(profiles, { method: 'get' });
    expect(result).toHaveLength(2);
    expect(result.every((p) => p.request.method === 'GET')).toBe(true);
  });

  it('filters by minimum duration', () => {
    const result = applyProfileFilters(profiles, { minDuration: 50 });
    expect(result.map((p) => p.performance.duration)).toEqual([100, 50]);
  });

  it('filters by maximum duration', () => {
    const result = applyProfileFilters(profiles, { maxDuration: 10 });
    expect(result.map((p) => p.performance.duration)).toEqual([10]);
  });

  it('treats an undefined duration as 0 for min filtering', () => {
    const withoutDuration = [makeProfile({ duration: undefined })];
    expect(applyProfileFilters(withoutDuration, { minDuration: 1 })).toHaveLength(0);
    expect(applyProfileFilters(withoutDuration, { maxDuration: 0 })).toHaveLength(1);
  });

  it('filters by exact status code', () => {
    const result = applyProfileFilters(profiles, { statusCode: 500 });
    expect(result).toHaveLength(1);
    expect(result[0]?.response?.statusCode).toBe(500);
  });

  it('excludes profiles without a matching response status', () => {
    const noResponse = [makeProfile({ statusCode: undefined })];
    expect(applyProfileFilters(noResponse, { statusCode: 200 })).toHaveLength(0);
  });

  it('filters by url substring case-insensitively', () => {
    const result = applyProfileFilters(profiles, { urlPattern: 'users' });
    expect(result.map((p) => p.request.url)).toEqual(['/users', '/Users/42']);
  });

  it('combines multiple filters', () => {
    const result = applyProfileFilters(profiles, {
      method: 'GET',
      urlPattern: 'users',
      maxDuration: 20,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.request.url).toBe('/users');
  });
});
