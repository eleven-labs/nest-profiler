import { Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type {
  ExceptionEntry,
  GraphQLInfo,
  IContextAdapter,
  Profile,
} from '@eleven-labs/nest-profiler';
import { PROFILER_REQ_KEY } from '@eleven-labs/nest-profiler';

type GqlResolveInfo = {
  fieldName?: string;
  operation?: { operation?: 'query' | 'mutation' | 'subscription' };
};

type GqlContext = Record<string, unknown>;

type GraphQLModule = { parse: (s: string) => unknown; print: (ast: unknown) => string };

/**
 * Attempts to format the query using the `graphql` package's printer.
 * Returns the original string when formatting is not possible.
 */
function tryFormatQuery(query: string): string {
  try {
    // graphql is an optional peer dep — dynamic require avoids a hard load error when absent.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parse, print } = require('graphql') as GraphQLModule;
    return print(parse(query));
  } catch {
    return query;
  }
}

/**
 * Parses the GraphQL operation type from the raw query string.
 */
function detectOperationType(query: string): GraphQLInfo['operationType'] {
  const trimmed = query.trimStart();
  if (trimmed.startsWith('mutation')) return 'mutation';
  if (trimmed.startsWith('subscription')) return 'subscription';
  return 'query';
}

/**
 * Extracts the entry-point field name from the raw query string.
 */
function detectFieldName(query: string): string {
  const match = query.match(
    /(?:query|mutation|subscription)\s*\w*\s*(?:\([^)]*\))?\s*(?:@\w+\s*)*\{\s*(\w+)|^\s*\{\s*(\w+)/,
  );
  return match?.[1] ?? match?.[2] ?? 'unknown';
}

@Injectable()
export class GraphQLContextAdapter implements IContextAdapter {
  readonly contextType = 'graphql';

  recoverProfile(ctx: ExecutionContext): Profile | null {
    const [, , gqlCtx] = ctx.getArgs<[unknown, unknown, GqlContext]>();
    if (!gqlCtx) return null;

    // Try multiple paths: Apollo/yoga expose req, Mercurius exposes request
    const candidates = [gqlCtx['req'], gqlCtx['request'], gqlCtx].filter(Boolean) as Record<
      symbol,
      unknown
    >[];

    for (const candidate of candidates) {
      const profile = candidate[PROFILER_REQ_KEY];
      if (profile) return profile as Profile;
    }

    return null;
  }

  enrichProfile(profile: Profile, ctx: ExecutionContext): void {
    const [, , gqlCtx, info] = ctx.getArgs<[unknown, unknown, GqlContext, GqlResolveInfo]>();

    const operationType: GraphQLInfo['operationType'] = info?.operation?.operation ?? 'query';
    const fieldName = info?.fieldName ?? 'unknown';

    const reqCandidates = [gqlCtx?.['req'], gqlCtx?.['request'], gqlCtx].filter(Boolean) as Record<
      string,
      unknown
    >[];

    let operationName: string | undefined;
    let query: string | undefined;
    let variables: Record<string, unknown> | undefined;

    for (const candidate of reqCandidates) {
      const body = candidate['body'] as Record<string, unknown> | undefined;
      if (body) {
        operationName = body['operationName'] as string | undefined;
        query = body['query'] as string | undefined;
        variables = body['variables'] as Record<string, unknown> | undefined;
        break;
      }
    }

    profile.request.graphql = {
      operationType,
      fieldName,
      ...(operationName !== undefined && { operationName }),
      ...(query !== undefined && { query: tryFormatQuery(query) }),
      ...(variables !== undefined && { variables }),
    };
  }

  /**
   * Called by ProfilerInterceptor after every HTTP response.
   * Handles GraphQL-over-HTTP requests where no resolver may have run
   * (e.g. schema validation failures) and surfaces GraphQL errors as exceptions.
   */
  enrichHttpResponse(profile: Profile, req: Record<string, unknown>, responseBody: unknown): void {
    // Apollo 4 may handle body parsing internally, so req.body can be undefined.
    // Fall back to profile.request.body (set by ProfilerMiddleware when collectBody: true)
    // or to the raw body captured by Express before Apollo processes it.
    const body =
      (req['body'] as Record<string, unknown> | undefined) ??
      (profile.request.body as Record<string, unknown> | undefined);
    if (!body || typeof body['query'] !== 'string') return;

    const rawQuery = body['query'];

    // Populate graphql metadata when no resolver ran (e.g. validation failure)
    if (!profile.request.graphql) {
      profile.request.graphql = {
        operationType: detectOperationType(rawQuery),
        fieldName: detectFieldName(rawQuery),
        ...(typeof body['operationName'] === 'string' && { operationName: body['operationName'] }),
        query: tryFormatQuery(rawQuery),
        ...(body['variables'] !== null &&
          body['variables'] !== undefined &&
          typeof body['variables'] === 'object' && {
            variables: body['variables'] as Record<string, unknown>,
          }),
      };
    } else if (profile.request.graphql.query) {
      // Resolver ran — still format the query for consistent display
      profile.request.graphql = {
        ...profile.request.graphql,
        query: tryFormatQuery(profile.request.graphql.query),
      };
    }

    // Surface GraphQL-level errors (validation, resolver) as profiler exceptions
    const gqlResponse = responseBody as { errors?: unknown[] } | null;
    if (!Array.isArray(gqlResponse?.errors)) return;

    for (const err of gqlResponse.errors) {
      const errObj = err as Record<string, unknown> | null;
      if (!errObj || typeof errObj['message'] !== 'string') continue;

      const entry: ExceptionEntry = {
        name: 'GraphQLError',
        message: errObj['message'],
        timestamp: Date.now(),
      };

      const parts: string[] = [];
      if (errObj['locations']) parts.push(`Locations: ${JSON.stringify(errObj['locations'])}`);
      if (errObj['extensions']) parts.push(`Extensions: ${JSON.stringify(errObj['extensions'])}`);
      if (parts.length > 0) entry.stack = parts.join('\n');

      profile.exceptions.push(entry);
    }
  }
}
