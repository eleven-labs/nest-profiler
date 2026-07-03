import { summarizeProfile } from './profile-summary';
import type { Profile } from '../interfaces/profile.interface';

function httpProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    token: 'tok',
    createdAt: 123,
    entrypoint: {
      type: 'http',
      data: { method: 'get', url: '/api/Users', headers: {}, query: {} },
    },
    response: { statusCode: 404, headers: {} },
    performance: { startTime: 0, heapUsed: 0, duration: 42 },
    logs: [],
    exceptions: [{ name: 'Error', message: 'boom', timestamp: 0 }],
    collectors: {},
    ...overrides,
  };
}

describe('summarizeProfile', () => {
  it('projects the base fields, uppercasing method and lowercasing the search haystack', () => {
    const summary = summarizeProfile(httpProfile());
    expect(summary).toMatchObject({
      token: 'tok',
      createdAt: 123,
      type: 'http',
      method: 'GET',
      url: '/api/Users',
      statusCode: 404,
      duration: 42,
      hasExceptions: true,
    });
    expect(summary.search).toContain('/api/users');
    expect(summary.attributes).toEqual({});
  });

  it('defaults a missing duration to 0', () => {
    const summary = summarizeProfile(httpProfile({ performance: { startTime: 0, heapUsed: 0 } }));
    expect(summary.duration).toBe(0);
  });

  it('leaves method/url undefined for a non-HTTP entrypoint', () => {
    const summary = summarizeProfile(
      httpProfile({ entrypoint: { type: 'command', data: { name: 'sync:posts' } } }),
    );
    expect(summary.method).toBeUndefined();
    expect(summary.url).toBeUndefined();
    // Generic string fields still feed the search haystack.
    expect(summary.search).toContain('sync:posts');
  });

  it('folds GraphQL operation and field names into the search haystack', () => {
    const summary = summarizeProfile(
      httpProfile({
        entrypoint: {
          type: 'graphql',
          data: {
            method: 'POST',
            url: '/graphql',
            headers: {},
            query: {},
            graphql: { operationType: 'query', operationName: 'GetBooks', fieldName: 'books' },
          },
        },
      }),
    );
    expect(summary.search).toContain('getbooks');
    expect(summary.search).toContain('books');
  });

  it('applies the index-attributes projection', () => {
    const summary = summarizeProfile(httpProfile(), () => ({ operationType: 'query' }));
    expect(summary.attributes).toEqual({ operationType: 'query' });
  });
});
