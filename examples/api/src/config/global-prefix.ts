import { RequestMethod } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';

/**
 * Version every business route under `/api/v1`. A few paths stay at the root:
 * `/health` (probes), the GraphQL endpoint, and the profiler UI + its assets.
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
      { path: '_profiler', method: RequestMethod.ALL },
      { path: '_profiler/*path', method: RequestMethod.ALL },
    ],
  });
}
