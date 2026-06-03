import type { ExecutionContext } from '@nestjs/common';
import { GraphQLContextAdapter } from './graphql-context.adapter';
import { PROFILER_REQ_KEY } from '../constants';
import type { Profile } from '../interfaces/profile.interface';

function makeProfile(): Profile {
  return {
    token: 'tok',
    createdAt: Date.now(),
    request: { method: 'POST', url: '/graphql', headers: {}, query: {} },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

function makeCtx(args: unknown[]): ExecutionContext {
  return {
    getType: () => 'graphql',
    getArgs: () => args,
  } as unknown as ExecutionContext;
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

      expect(profile.request.graphql).toEqual({
        operationType: 'query',
        fieldName: 'books',
        query: '{ books { id } }',
        variables: { limit: 10 },
        operationName: 'GetBooks',
      });
    });

    it('handles mutation operationType', () => {
      const profile = makeProfile();
      const info = { fieldName: 'createBook', operation: { operation: 'mutation' as const } };
      const ctx = makeCtx([undefined, undefined, { req: {} }, info]);

      adapter.enrichProfile(profile, ctx);

      expect(profile.request.graphql?.operationType).toBe('mutation');
    });

    it('handles subscription operationType', () => {
      const profile = makeProfile();
      const info = {
        fieldName: 'onBookCreated',
        operation: { operation: 'subscription' as const },
      };
      const ctx = makeCtx([undefined, undefined, { req: {} }, info]);

      adapter.enrichProfile(profile, ctx);

      expect(profile.request.graphql?.operationType).toBe('subscription');
    });

    it('defaults operationType to "query" when info is missing', () => {
      const profile = makeProfile();
      const ctx = makeCtx([undefined, undefined, { req: {} }, undefined]);

      adapter.enrichProfile(profile, ctx);

      expect(profile.request.graphql?.operationType).toBe('query');
    });

    it('defaults operationType to "query" when info.operation.operation is absent', () => {
      const profile = makeProfile();
      const info = { fieldName: 'books', operation: {} };
      const ctx = makeCtx([undefined, undefined, { req: {} }, info]);

      adapter.enrichProfile(profile, ctx);

      expect(profile.request.graphql?.operationType).toBe('query');
    });

    it('omits undefined optional fields', () => {
      const profile = makeProfile();
      const info = { fieldName: 'books', operation: { operation: 'query' as const } };
      const ctx = makeCtx([undefined, undefined, { req: {} }, info]);

      adapter.enrichProfile(profile, ctx);

      expect(profile.request.graphql).toEqual({ operationType: 'query', fieldName: 'books' });
      expect(profile.request.graphql).not.toHaveProperty('operationName');
      expect(profile.request.graphql).not.toHaveProperty('query');
      expect(profile.request.graphql).not.toHaveProperty('variables');
    });

    it('reads body from gqlCtx.request for Mercurius', () => {
      const profile = makeProfile();
      const request = { body: { query: 'mutation { createBook }', operationName: 'CreateBook' } };
      const info = { fieldName: 'createBook', operation: { operation: 'mutation' as const } };
      const ctx = makeCtx([undefined, undefined, { request }, info]);

      adapter.enrichProfile(profile, ctx);

      expect(profile.request.graphql?.query).toBe('mutation { createBook }');
      expect(profile.request.graphql?.operationName).toBe('CreateBook');
    });

    it('preserves complex nested variables', () => {
      const profile = makeProfile();
      const variables = { filter: { AND: [{ id: '1' }, { status: 'active' }] } };
      const req = { body: { query: '{ books }', variables } };
      const info = { fieldName: 'books', operation: { operation: 'query' as const } };
      const ctx = makeCtx([undefined, undefined, { req }, info]);

      adapter.enrichProfile(profile, ctx);

      expect(profile.request.graphql?.variables).toEqual(variables);
    });

    it('defaults fieldName to "unknown" when info is absent', () => {
      const profile = makeProfile();
      const ctx = makeCtx([undefined, undefined, { req: {} }, undefined]);

      adapter.enrichProfile(profile, ctx);

      expect(profile.request.graphql?.fieldName).toBe('unknown');
    });
  });
});
