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

/** Returns original string when formatting fails. */
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

function detectOperationType(query: string): GraphQLInfo['operationType'] {
  const trimmed = query.trimStart();
  if (trimmed.startsWith('mutation')) return 'mutation';
  if (trimmed.startsWith('subscription')) return 'subscription';
  return 'query';
}

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

  /** Populates GraphQL metadata and surfaces errors even when no resolver ran (e.g. validation failure). */
  enrichHttpResponse(profile: Profile, req: object, responseBody: unknown): void {
    const reqRecord = req as Record<string, unknown>;
    // Apollo may parse body internally — fall back to profiler-captured body.
    const body =
      (reqRecord['body'] as Record<string, unknown> | undefined) ??
      (profile.request.body as Record<string, unknown> | undefined);
    if (!body || typeof body['query'] !== 'string') return;

    const rawQuery = body['query'];

    if (!profile.request.graphql) {
      // No resolver ran (e.g. validation failure) — populate metadata from HTTP body.
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
      // Resolver ran — still format the query for consistent display.
      profile.request.graphql = {
        ...profile.request.graphql,
        query: tryFormatQuery(profile.request.graphql.query),
      };
    }

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
