import type { ProfilerFilterRequest } from '@eleven-labs/nest-profiler';
import { ignoreGraphQLPlayground, ignoreGraphQLIntrospection } from './filters';

function req(overrides: Partial<ProfilerFilterRequest> = {}): ProfilerFilterRequest {
  return { method: 'POST', url: '/graphql', headers: {}, ...overrides };
}

describe('ignoreGraphQLPlayground', () => {
  it('ignores GET requests with Accept: text/html (browser loading Sandbox UI)', () => {
    expect(
      ignoreGraphQLPlayground(
        req({ method: 'GET', headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } }),
      ),
    ).toBe(true);
  });

  it('does not ignore GET requests without text/html accept', () => {
    expect(
      ignoreGraphQLPlayground(req({ method: 'GET', headers: { accept: 'application/json' } })),
    ).toBe(false);
  });

  it('does not ignore POST requests even with text/html accept', () => {
    expect(ignoreGraphQLPlayground(req({ method: 'POST', headers: { accept: 'text/html' } }))).toBe(
      false,
    );
  });

  it('does not ignore GET requests with no accept header', () => {
    expect(ignoreGraphQLPlayground(req({ method: 'GET', headers: {} }))).toBe(false);
  });
});

describe('ignoreGraphQLIntrospection', () => {
  it('ignores named IntrospectionQuery by operationName', () => {
    expect(
      ignoreGraphQLIntrospection(
        req({
          body: {
            operationName: 'IntrospectionQuery',
            query: 'query IntrospectionQuery { __schema { queryType { name } } }',
          },
        }),
      ),
    ).toBe(true);
  });

  it('ignores anonymous introspection query containing __schema', () => {
    expect(
      ignoreGraphQLIntrospection(req({ body: { query: '{ __schema { types { name } } }' } })),
    ).toBe(true);
  });

  it('ignores queries referencing __type', () => {
    expect(
      ignoreGraphQLIntrospection(
        req({ body: { query: '{ __type(name: "Book") { fields { name } } }' } }),
      ),
    ).toBe(true);
  });

  it('does not ignore regular GraphQL queries', () => {
    expect(
      ignoreGraphQLIntrospection(
        req({ body: { operationName: 'GetBooks', query: 'query GetBooks { books { id } }' } }),
      ),
    ).toBe(false);
  });

  it('does not ignore non-POST requests', () => {
    expect(ignoreGraphQLIntrospection(req({ method: 'GET', body: undefined }))).toBe(false);
  });

  it('does not ignore POST requests without a body', () => {
    expect(ignoreGraphQLIntrospection(req({ body: undefined }))).toBe(false);
  });

  it('does not ignore POST requests with a null body', () => {
    expect(ignoreGraphQLIntrospection(req({ body: null }))).toBe(false);
  });
});
