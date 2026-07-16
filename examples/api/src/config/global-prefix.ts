import { RequestMethod } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';

/**
 * Version every business route under `/api/v1`. Two paths stay at the root:
 * `/health` (probes) and the GraphQL endpoint. The profiler UI stays at the
 * root too, but it excludes itself — no entry for it is needed here.
 *
 * Excluding a path does more than skip the prefix — `setGlobalPrefix` rebinds
 * the profiler's `forRoutes('*')` middleware to the routes Nest knows (the
 * prefixed ones plus every `exclude` entry). GraphQL is served by Apollo, not a
 * Nest router route, so without an explicit `graphql` exclusion the middleware
 * would never run for `/graphql` and the operations would drop out of the
 * profiler. Listing it here keeps `/graphql` at the root *and* profiled.
 *
 * Shared by `main.ts` and the e2e harness so both boot with identical routing.
 */
export function applyGlobalPrefix(app: INestApplication): void {
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.ALL },
      { path: 'graphql', method: RequestMethod.ALL },
    ],
  });
}
