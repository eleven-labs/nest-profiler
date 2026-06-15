import type { ExecutionContext } from '@nestjs/common';
import { PROFILER_REQ_KEY } from '@eleven-labs/nest-profiler';
import type { HttpRequestData, Profile } from '@eleven-labs/nest-profiler';
import { GraphQLContextAdapter } from './graphql-context.adapter';

function makeProfile(): Profile<HttpRequestData> {
  return {
    token: 'tok',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'POST', url: '/graphql', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

function gqlOf(profile: Profile<HttpRequestData>): HttpRequestData['graphql'] {
  return profile.entrypoint.data.graphql;
}

function makeCtx(args: unknown[]): ExecutionContext {
  return {
    getType: () => 'graphql',
    getArgs: () => args,
  } as ExecutionContext;
}

describe('GraphQLContextAdapter', () => {
  let adapter: GraphQLContextAdapter;

  beforeEach(() => {
    adapter = new GraphQLContextAdapter();
  });

  it('has contextType "graphql"', () => {
    expect(adapter.contextType).toBe('graphql');
  });

  describe('recoverProfile()', () => {
    it('finds profile via gqlCtx.req (Apollo / graphql-yoga)', () => {
      const profile = makeProfile();
      const req = { [PROFILER_REQ_KEY]: profile } as Record<symbol, unknown>;
      const ctx = makeCtx([undefined, undefined, { req }]);

      expect(adapter.recoverProfile(ctx)).toBe(profile);
    });

    it('finds profile via gqlCtx.request (Mercurius)', () => {
      const profile = makeProfile();
      const request = { [PROFILER_REQ_KEY]: profile } as Record<symbol, unknown>;
      const ctx = makeCtx([undefined, undefined, { request }]);

      expect(adapter.recoverProfile(ctx)).toBe(profile);
    });

    it('finds profile when gqlCtx itself is the request object', () => {
      const profile = makeProfile();
      const gqlCtx = { [PROFILER_REQ_KEY]: profile } as Record<symbol, unknown>;
      const ctx = makeCtx([undefined, undefined, gqlCtx]);

      expect(adapter.recoverProfile(ctx)).toBe(profile);
    });

    it('prefers gqlCtx.req over gqlCtx.request when both present', () => {
      const profileViaReq = makeProfile();
      const profileViaRequest = makeProfile();
      profileViaRequest.token = 'other';
      const req = { [PROFILER_REQ_KEY]: profileViaReq } as Record<symbol, unknown>;
      const request = { [PROFILER_REQ_KEY]: profileViaRequest } as Record<symbol, unknown>;
      const ctx = makeCtx([undefined, undefined, { req, request }]);

      expect(adapter.recoverProfile(ctx)).toBe(profileViaReq);
    });

    it('returns null when no profile key is found on any candidate', () => {
      const ctx = makeCtx([undefined, undefined, { req: {}, request: {} }]);
      expect(adapter.recoverProfile(ctx)).toBeNull();
    });

    it('returns null when gqlCtx is absent', () => {
      const ctx = makeCtx([undefined, undefined, undefined]);
      expect(adapter.recoverProfile(ctx)).toBeNull();
    });
  });

  describe('enrichProfile()', () => {
    it('promotes the http profile to the graphql entrypoint kind', () => {
      const profile = makeProfile();
      expect(profile.entrypoint.type).toBe('http');
      adapter.enrichProfile(profile, makeCtx([undefined, undefined, { req: {} }, undefined]));
      expect(profile.entrypoint.type).toBe('graphql');
    });

    it('sets all fields from req.body when present', () => {
      const profile = makeProfile();
      const req = {
        body: {
          query: '{ books { id } }',
          variables: { limit: 10 },
          operationName: 'GetBooks',
        },
      };
      const info = {
        fieldName: 'books',
        operation: { operation: 'query' as const },
      };
      const ctx = makeCtx([undefined, undefined, { req }, info]);

      adapter.enrichProfile(profile, ctx);

      expect(gqlOf(profile)?.operationType).toBe('query');
      expect(gqlOf(profile)?.fieldName).toBe('books');
      expect(gqlOf(profile)?.operationName).toBe('GetBooks');
      expect(gqlOf(profile)?.variables).toEqual({ limit: 10 });
      // query is formatted by tryFormatQuery — just check it's present
      expect(gqlOf(profile)?.query).toContain('books');
    });

    it('handles mutation operationType', () => {
      const profile = makeProfile();
      const info = { fieldName: 'createBook', operation: { operation: 'mutation' as const } };
      const ctx = makeCtx([undefined, undefined, { req: {} }, info]);

      adapter.enrichProfile(profile, ctx);

      expect(gqlOf(profile)?.operationType).toBe('mutation');
    });

    it('handles subscription operationType', () => {
      const profile = makeProfile();
      const info = {
        fieldName: 'onBookCreated',
        operation: { operation: 'subscription' as const },
      };
      const ctx = makeCtx([undefined, undefined, { req: {} }, info]);

      adapter.enrichProfile(profile, ctx);

      expect(gqlOf(profile)?.operationType).toBe('subscription');
    });

    it('defaults operationType to "query" when info is missing', () => {
      const profile = makeProfile();
      const ctx = makeCtx([undefined, undefined, { req: {} }, undefined]);

      adapter.enrichProfile(profile, ctx);

      expect(gqlOf(profile)?.operationType).toBe('query');
    });

    it('defaults operationType to "query" when info.operation.operation is absent', () => {
      const profile = makeProfile();
      const info = { fieldName: 'books', operation: {} };
      const ctx = makeCtx([undefined, undefined, { req: {} }, info]);

      adapter.enrichProfile(profile, ctx);

      expect(gqlOf(profile)?.operationType).toBe('query');
    });

    it('omits undefined optional fields', () => {
      const profile = makeProfile();
      const info = { fieldName: 'books', operation: { operation: 'query' as const } };
      const ctx = makeCtx([undefined, undefined, { req: {} }, info]);

      adapter.enrichProfile(profile, ctx);

      expect(gqlOf(profile)).toEqual({ operationType: 'query', fieldName: 'books' });
      expect(gqlOf(profile)).not.toHaveProperty('operationName');
      expect(gqlOf(profile)).not.toHaveProperty('query');
      expect(gqlOf(profile)).not.toHaveProperty('variables');
    });

    it('reads body from gqlCtx.request for Mercurius', () => {
      const profile = makeProfile();
      const request = { body: { query: 'mutation { createBook }', operationName: 'CreateBook' } };
      const info = { fieldName: 'createBook', operation: { operation: 'mutation' as const } };
      const ctx = makeCtx([undefined, undefined, { request }, info]);

      adapter.enrichProfile(profile, ctx);

      expect(gqlOf(profile)?.query).toContain('createBook');
      expect(gqlOf(profile)?.operationName).toBe('CreateBook');
    });

    it('preserves complex nested variables', () => {
      const profile = makeProfile();
      const variables = { filter: { AND: [{ id: '1' }, { status: 'active' }] } };
      const req = { body: { query: '{ books }', variables } };
      const info = { fieldName: 'books', operation: { operation: 'query' as const } };
      const ctx = makeCtx([undefined, undefined, { req }, info]);

      adapter.enrichProfile(profile, ctx);

      expect(gqlOf(profile)?.variables).toEqual(variables);
    });

    it('defaults fieldName to "unknown" when info is absent', () => {
      const profile = makeProfile();
      const ctx = makeCtx([undefined, undefined, { req: {} }, undefined]);

      adapter.enrichProfile(profile, ctx);

      expect(gqlOf(profile)?.fieldName).toBe('unknown');
    });

    it('formats the query with graphql.print(parse())', () => {
      const profile = makeProfile();
      const info = { fieldName: 'books', operation: { operation: 'query' as const } };
      const ctx = makeCtx([
        undefined,
        undefined,
        { req: { body: { query: 'query GetBooks{books{id}}' } } },
        info,
      ]);

      adapter.enrichProfile(profile, ctx);

      expect(gqlOf(profile)?.query).toContain('GetBooks');
    });
  });

  describe('enrichHttpResponse()', () => {
    function makeHttpReq(body: Record<string, unknown>): Record<string, unknown> {
      return { body };
    }

    it('promotes the profile to the graphql kind when the body carries a query', () => {
      const profile = makeProfile();
      adapter.enrichHttpResponse(profile, makeHttpReq({ query: '{ books { id } }' }), {});
      expect(profile.entrypoint.type).toBe('graphql');
    });

    it('leaves a non-graphql response as the http kind', () => {
      const profile = makeProfile();
      adapter.enrichHttpResponse(profile, makeHttpReq({}), {});
      expect(profile.entrypoint.type).toBe('http');
    });

    it('populates graphql info from HTTP body when no resolver ran (validation failure)', () => {
      const profile = makeProfile();
      const req = makeHttpReq({
        query: 'query GetBook($id: ID!) { book(id: $id) { idf } }',
        variables: { id: '1' },
        operationName: 'GetBook',
      });
      const responseBody = {
        errors: [{ message: "Cannot query field 'idf' on type 'Book'." }],
      };

      adapter.enrichHttpResponse(profile, req, responseBody);

      expect(gqlOf(profile)?.operationType).toBe('query');
      expect(gqlOf(profile)?.fieldName).toBe('book');
      expect(gqlOf(profile)?.operationName).toBe('GetBook');
      expect(gqlOf(profile)?.variables).toEqual({ id: '1' });
      expect(profile.exceptions).toHaveLength(1);
      expect(profile.exceptions[0]?.name).toBe('GraphQLError');
      expect(profile.exceptions[0]?.message).toContain("Cannot query field 'idf'");
    });

    it('detects a field after operation directives', () => {
      const profile = makeProfile();
      const req = makeHttpReq({
        query: 'query GetBook($id: ID!) @cacheControl(maxAge: 60) { book(id: $id) { id } }',
      });

      adapter.enrichHttpResponse(profile, req, {});

      expect(gqlOf(profile)?.fieldName).toBe('book');
    });

    it('detects a field after comments and string values in operation metadata', () => {
      const profile = makeProfile();
      const req = makeHttpReq({
        query: [
          '# leading comment',
          'query GetBook(',
          '  # variable comment',
          '  $id: ID!,',
          '  $note: String = "query(\\""',
          ') @cacheControl(reason: """query(',
          ')""") {',
          '  # selection comment',
          '  book(id: $id) { id }',
          '}',
        ].join('\n'),
      });

      adapter.enrichHttpResponse(profile, req, {});

      expect(gqlOf(profile)?.fieldName).toBe('book');
    });

    it('detects aliased fields from shorthand queries', () => {
      const profile = makeProfile();
      const req = makeHttpReq({ query: '{ latest: books { id } }' });

      adapter.enrichHttpResponse(profile, req, {});

      expect(gqlOf(profile)?.fieldName).toBe('books');
    });

    it('falls back to unknown for malformed shorthand selections', () => {
      const profile = makeProfile();
      const req = makeHttpReq({ query: '{ alias: }' });

      adapter.enrichHttpResponse(profile, req, {});

      expect(gqlOf(profile)?.fieldName).toBe('unknown');
    });

    it('falls back to unknown for non-operation documents', () => {
      const profile = makeProfile();
      const req = makeHttpReq({ query: 'fragment BookFields on Book { id }' });

      adapter.enrichHttpResponse(profile, req, {});

      expect(gqlOf(profile)?.fieldName).toBe('unknown');
    });

    it('falls back to unknown for invalid directives', () => {
      const profile = makeProfile();
      const req = makeHttpReq({ query: 'query GetBook @ { book { id } }' });

      adapter.enrichHttpResponse(profile, req, {});

      expect(gqlOf(profile)?.fieldName).toBe('unknown');
    });

    it('falls back to unknown when no selection set is present', () => {
      const profile = makeProfile();
      const req = makeHttpReq({ query: 'query GetBook($id: ID!' });

      adapter.enrichHttpResponse(profile, req, {});

      expect(gqlOf(profile)?.fieldName).toBe('unknown');
    });

    it('handles pathological operation text without backtracking', () => {
      const profile = makeProfile();
      const req = makeHttpReq({ query: `query ${'query('.repeat(2_000)}` });

      adapter.enrichHttpResponse(profile, req, {});

      expect(gqlOf(profile)?.fieldName).toBe('unknown');
    });

    it('detects mutation in HTTP body', () => {
      const profile = makeProfile();
      const req = makeHttpReq({ query: 'mutation CreateBook { createBook { id } }' });

      adapter.enrichHttpResponse(profile, req, {});

      expect(gqlOf(profile)?.operationType).toBe('mutation');
    });

    it('detects subscription in HTTP body', () => {
      const profile = makeProfile();
      const req = makeHttpReq({ query: 'subscription { onBookCreated { id } }' });

      adapter.enrichHttpResponse(profile, req, {});

      expect(gqlOf(profile)?.operationType).toBe('subscription');
    });

    it('reformats the query when graphql info was already set by the resolver', () => {
      const profile = makeProfile();
      profile.entrypoint.data.graphql = {
        operationType: 'query',
        fieldName: 'books',
        query: 'query{books{id}}',
      };
      const req = makeHttpReq({ query: 'query{books{id}}' });

      adapter.enrichHttpResponse(profile, req, {});

      expect(gqlOf(profile)?.fieldName).toBe('books');
      expect(gqlOf(profile)?.query).toContain('books');
    });

    it('keeps the original query text when the stored query cannot be parsed', () => {
      const profile = makeProfile();
      profile.entrypoint.data.graphql = {
        operationType: 'query',
        fieldName: 'books',
        query: 'query {',
      };
      const req = makeHttpReq({ query: 'query {' });

      adapter.enrichHttpResponse(profile, req, {});

      expect(gqlOf(profile)?.query).toBe('query {');
    });

    it('skips when request body has no query field', () => {
      const profile = makeProfile();
      const req = makeHttpReq({ notAQuery: 'rest-request' });

      adapter.enrichHttpResponse(profile, req, {});

      expect(gqlOf(profile)).toBeUndefined();
    });

    it('adds locations and extensions to exception stack', () => {
      const profile = makeProfile();
      const req = makeHttpReq({ query: '{ book { idf } }' });
      const responseBody = {
        errors: [
          {
            message: 'bad field',
            locations: [{ line: 1, column: 9 }],
            extensions: { code: 'VALIDATION_FAILED' },
          },
        ],
      };

      adapter.enrichHttpResponse(profile, req, responseBody);

      expect(profile.exceptions[0]?.stack).toContain('Locations:');
      expect(profile.exceptions[0]?.stack).toContain('Extensions:');
    });

    it('skips errors without a message', () => {
      const profile = makeProfile();
      const req = makeHttpReq({ query: '{ books { id } }' });

      adapter.enrichHttpResponse(profile, req, { errors: [{ code: 'UNKNOWN' }] });

      expect(profile.exceptions).toHaveLength(0);
    });
  });

  describe('fallback heuristics for unparsable documents', () => {
    it('detects mutation from raw text and keeps the query unformatted', () => {
      const profile = makeProfile();
      const req = { body: { query: 'mutation CreateBook {' } };

      adapter.enrichHttpResponse(profile, req, {});

      expect(gqlOf(profile)?.operationType).toBe('mutation');
      expect(gqlOf(profile)?.fieldName).toBe('unknown');
      expect(gqlOf(profile)?.query).toBe('mutation CreateBook {');
    });

    it('detects subscription from raw text', () => {
      const profile = makeProfile();
      const req = { body: { query: 'subscription {' } };

      adapter.enrichHttpResponse(profile, req, {});

      expect(gqlOf(profile)?.operationType).toBe('subscription');
      expect(gqlOf(profile)?.fieldName).toBe('unknown');
    });
  });
});
