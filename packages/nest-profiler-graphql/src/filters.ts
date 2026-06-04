import type { ProfilerFilterRequest, ProfilerRequestFilter } from '@eleven-labs/nest-profiler';

/** Skips GET requests with `Accept: text/html` — the Apollo Sandbox page load, not a real GraphQL request. */
export const ignoreGraphQLPlayground: ProfilerRequestFilter = (req: ProfilerFilterRequest) => {
  if (req.method !== 'GET') return false;
  const accept = typeof req.headers['accept'] === 'string' ? req.headers['accept'] : '';
  return accept.includes('text/html');
};

/** Skips introspection queries — matched by `operationName: 'IntrospectionQuery'` or a body containing `__schema`/`__type`. */
export const ignoreGraphQLIntrospection: ProfilerRequestFilter = (req: ProfilerFilterRequest) => {
  if (req.method !== 'POST') return false;
  const body = req.body as { query?: unknown; operationName?: unknown } | undefined;
  if (!body) return false;
  if (body.operationName === 'IntrospectionQuery') return true;
  if (typeof body.query === 'string') {
    return body.query.includes('__schema') || body.query.includes('__type');
  }
  return false;
};
