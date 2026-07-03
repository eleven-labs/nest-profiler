import {
  applyQueryInMemory,
  distinctInMemory,
  matchesCriterion,
  matchesQuery,
} from './profiler-query';
import type { ProfilerQuery } from './profiler-query';
import { summarizeProfile } from './profile-summary';
import type { IndexAttributesProvider } from './profile-summary';
import type { Profile } from '../interfaces/profile.interface';

function profile(overrides: {
  token?: string;
  type?: string;
  createdAt?: number;
  method?: string;
  statusCode?: number;
  duration?: number;
  exceptions?: number;
}): Profile {
  return {
    token: overrides.token ?? 't',
    createdAt: overrides.createdAt ?? 0,
    entrypoint: {
      type: overrides.type ?? 'http',
      data: { method: overrides.method ?? 'GET', url: '/x', headers: {}, query: {} },
    },
    response:
      overrides.statusCode !== undefined
        ? { statusCode: overrides.statusCode, headers: {} }
        : undefined,
    performance: { startTime: 0, heapUsed: 0, duration: overrides.duration },
    logs: [],
    exceptions: Array.from({ length: overrides.exceptions ?? 0 }, () => ({
      name: 'E',
      message: 'm',
      timestamp: 0,
    })),
    collectors: {},
  };
}

const attrs: IndexAttributesProvider = (p) => ({ kind: `k-${p.entrypoint.type}` });

describe('matchesCriterion', () => {
  const summary = summarizeProfile(
    profile({ method: 'post', statusCode: 404, duration: 120 }),
    () => ({ operationType: 'mutation' }),
  );

  it('eq compares strings case-insensitively and other values strictly', () => {
    expect(matchesCriterion(summary, { field: 'method', op: 'eq', value: 'POST' })).toBe(true);
    expect(matchesCriterion(summary, { field: 'statusCode', op: 'eq', value: 404 })).toBe(true);
    expect(matchesCriterion(summary, { field: 'statusCode', op: 'eq', value: 200 })).toBe(false);
  });

  it('gte/lte compare numbers', () => {
    expect(matchesCriterion(summary, { field: 'duration', op: 'gte', value: 120 })).toBe(true);
    expect(matchesCriterion(summary, { field: 'duration', op: 'lte', value: 119 })).toBe(false);
  });

  it('range checks inclusive bounds', () => {
    expect(matchesCriterion(summary, { field: 'statusCode', op: 'range', value: [400, 499] })).toBe(
      true,
    );
    expect(matchesCriterion(summary, { field: 'statusCode', op: 'range', value: [500, 599] })).toBe(
      false,
    );
  });

  it('contains does a case-insensitive substring match', () => {
    expect(matchesCriterion(summary, { field: 'search', op: 'contains', value: '/X' })).toBe(true);
    expect(matchesCriterion(summary, { field: 'search', op: 'contains', value: 'nope' })).toBe(
      false,
    );
  });

  it('truthy tests coerced truthiness', () => {
    const withExc = summarizeProfile(profile({ exceptions: 1 }));
    expect(matchesCriterion(withExc, { field: 'hasExceptions', op: 'truthy' })).toBe(true);
    expect(matchesCriterion(summary, { field: 'hasExceptions', op: 'truthy' })).toBe(false);
  });

  it('resolves attributes.<key> paths', () => {
    expect(
      matchesCriterion(summary, { field: 'attributes.operationType', op: 'eq', value: 'mutation' }),
    ).toBe(true);
  });

  it('returns false for an unknown operator', () => {
    expect(matchesCriterion(summary, { field: 'method', op: 'nope' as never, value: 'POST' })).toBe(
      false,
    );
  });
});

describe('matchesQuery', () => {
  const summary = summarizeProfile(profile({ type: 'graphql' }));

  it('honours typeIn / typeNotIn', () => {
    const base: ProfilerQuery = { filters: [], page: 1, pageSize: 10 };
    expect(matchesQuery(summary, { ...base, typeIn: ['graphql'] })).toBe(true);
    expect(matchesQuery(summary, { ...base, typeIn: ['http'] })).toBe(false);
    expect(matchesQuery(summary, { ...base, typeNotIn: ['graphql'] })).toBe(false);
    expect(matchesQuery(summary, { ...base, typeNotIn: ['http'] })).toBe(true);
  });
});

describe('applyQueryInMemory', () => {
  const profiles = [
    profile({ token: 'a', type: 'http', createdAt: 1, statusCode: 200 }),
    profile({ token: 'b', type: 'http', createdAt: 2, statusCode: 500 }),
    profile({ token: 'c', type: 'graphql', createdAt: 3, statusCode: 200 }),
    profile({ token: 'd', type: 'http', createdAt: 4, statusCode: 200 }),
  ];

  it('sorts newest-first, paginates and reports the total', () => {
    const page = applyQueryInMemory(profiles, { filters: [], page: 1, pageSize: 2 });
    expect(page.total).toBe(4);
    expect(page.items.map((p) => p.token)).toEqual(['d', 'c']);
  });

  it('serves a later page', () => {
    const page = applyQueryInMemory(profiles, { filters: [], page: 2, pageSize: 2 });
    expect(page.items.map((p) => p.token)).toEqual(['b', 'a']);
  });

  it('applies type + filter criteria before paginating', () => {
    const page = applyQueryInMemory(profiles, {
      typeIn: ['http'],
      filters: [{ field: 'statusCode', op: 'eq', value: 200 }],
      page: 1,
      pageSize: 10,
    });
    expect(page.total).toBe(2);
    expect(page.items.map((p) => p.token)).toEqual(['d', 'a']);
  });

  it('supports ascending sort', () => {
    const page = applyQueryInMemory(profiles, {
      filters: [],
      sort: { field: 'createdAt', direction: 'asc' },
      page: 1,
      pageSize: 2,
    });
    expect(page.items.map((p) => p.token)).toEqual(['a', 'b']);
  });
});

describe('distinctInMemory', () => {
  const profiles = [
    profile({ type: 'http', method: 'get' }),
    profile({ type: 'http', method: 'post' }),
    profile({ type: 'graphql', method: 'post' }),
  ];

  it('returns distinct non-empty values of a field', () => {
    expect(distinctInMemory(profiles, 'method').sort()).toEqual(['GET', 'POST']);
  });

  it('restricts to typeIn and resolves attribute fields', () => {
    expect(distinctInMemory(profiles, 'attributes.kind', attrs, ['graphql'])).toEqual([
      'k-graphql',
    ]);
  });
});
