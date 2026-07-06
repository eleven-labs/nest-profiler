import type { ProfilerFilterRequest, ProfilerRequestFilter } from '@eleven-labs/nest-profiler';

/**
 * Builds a filter that skips the GraphQL IDE page load (a `GET` with `Accept: text/html`
 * on the GraphQL endpoint — e.g. Apollo Sandbox), without touching real GraphQL `POST`s or
 * the host application's other HTML pages.
 *
 * @param graphqlPath - Path prefix the GraphQL endpoint is mounted on. Default `/graphql`.
 */
export function createIgnoreGraphQLPlayground(graphqlPath = '/graphql'): ProfilerRequestFilter {
  return (req: ProfilerFilterRequest) => {
    if (req.method !== 'GET') return false;
    // Scope to the GraphQL endpoint: without this, every HTML page of a mixed SSR + GraphQL
    // app would be skipped.
    const path = req.path ?? req.url ?? '';
    if (!path.startsWith(graphqlPath)) return false;
    const accept = typeof req.headers['accept'] === 'string' ? req.headers['accept'] : '';
    return accept.includes('text/html');
  };
}

/** Skips the GraphQL IDE page load on the default `/graphql` endpoint. */
export const ignoreGraphQLPlayground: ProfilerRequestFilter = createIgnoreGraphQLPlayground();

/**
 * Skips introspection queries — matched by `operationName: 'IntrospectionQuery'` or a body
 * selecting the `__schema` / `__type(...)` introspection roots. The `__type` root always
 * takes a `name` argument, so it is matched as `__type(` — this deliberately does NOT match
 * the ubiquitous `__typename` meta-field Apollo Client adds to normal operations (which would
 * otherwise cause almost all real traffic to be skipped).
 */
export const ignoreGraphQLIntrospection: ProfilerRequestFilter = (req: ProfilerFilterRequest) => {
  if (req.method !== 'POST') return false;
  const body = req.body as { query?: unknown; operationName?: unknown } | undefined;
  if (!body) return false;
  if (body.operationName === 'IntrospectionQuery') return true;
  if (typeof body.query === 'string') {
    return body.query.includes('__schema') || /__type\s*\(/.test(body.query);
  }
  return false;
};
