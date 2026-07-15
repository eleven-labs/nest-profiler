import { Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Kind, parse, print } from 'graphql';
import type { FieldNode, OperationDefinitionNode } from 'graphql';
import type {
  ExceptionEntry,
  GraphQLInfo,
  HttpRequestData,
  IContextAdapter,
  Profile,
} from '@eleven-labs/nest-profiler';
import { PROFILER_REQ_KEY } from '@eleven-labs/nest-profiler';
import { GRAPHQL_ENTRYPOINT_TYPE } from '../graphql-entrypoint';

type GqlResolveInfo = {
  fieldName?: string;
  operation?: { operation?: 'query' | 'mutation' | 'subscription' };
};

type GqlContext = Record<string, unknown>;

/** Returns original string when formatting fails. */
function tryFormatQuery(query: string): string {
  try {
    return print(parse(query));
  } catch {
    return query;
  }
}

/** Linear fallback when the graphql parser rejects the document. */
function detectOperationType(query: string): GraphQLInfo['operationType'] {
  const trimmed = query.trimStart();
  if (trimmed.startsWith('mutation')) return 'mutation';
  if (trimmed.startsWith('subscription')) return 'subscription';
  return 'query';
}

type GqlQueryMetadata = {
  operationType: GraphQLInfo['operationType'];
  fieldName: string;
  query: string;
};

function extractQueryMetadata(rawQuery: string): GqlQueryMetadata {
  try {
    const document = parse(rawQuery, { noLocation: true });
    const operation = document.definitions.find(
      (def): def is OperationDefinitionNode => def.kind === Kind.OPERATION_DEFINITION,
    );
    const field = operation?.selectionSet.selections.find(
      (sel): sel is FieldNode => sel.kind === Kind.FIELD,
    );

    return {
      operationType: operation?.operation ?? 'query',
      fieldName: field?.name.value ?? 'unknown',
      query: print(document),
    };
  } catch {
    return {
      operationType: detectOperationType(rawQuery),
      fieldName: 'unknown',
      query: rawQuery,
    };
  }
}

@Injectable()
export class GraphQLContextAdapter implements IContextAdapter {
  readonly contextType = 'graphql';

  recoverProfile(ctx: ExecutionContext): Profile<HttpRequestData> | null {
    const [, , gqlCtx] = ctx.getArgs<[unknown, unknown, GqlContext]>();
    if (!gqlCtx) return null;

    // Try multiple paths: Apollo/yoga expose req, Mercurius exposes request
    const candidates = [gqlCtx['req'], gqlCtx['request'], gqlCtx].filter(Boolean) as Record<
      symbol,
      unknown
    >[];

    for (const candidate of candidates) {
      const profile = candidate[PROFILER_REQ_KEY];
      if (profile) return profile as Profile<HttpRequestData>;
    }

    return null;
  }

  /**
   * Returns the underlying HTTP request behind the GraphQL operation (the one carrying
   * `req.user`/headers), so the interceptor can repose it in CLS on the recovered path and
   * the auth collector no longer reports an authenticated GraphQL request as anonymous.
   */
  getRequest(ctx: ExecutionContext): object | undefined {
    const [, , gqlCtx] = ctx.getArgs<[unknown, unknown, GqlContext]>();
    if (!gqlCtx) return undefined;
    const candidates = [gqlCtx['req'], gqlCtx['request'], gqlCtx].filter(Boolean) as Record<
      symbol,
      unknown
    >[];
    for (const candidate of candidates) {
      if (candidate[PROFILER_REQ_KEY]) return candidate;
    }
    return undefined;
  }

  enrichProfile(profile: Profile<HttpRequestData>, ctx: ExecutionContext): void {
    // A GraphQL operation is its own entrypoint kind: flip the `http` discriminator
    // the middleware seeded so the profile renders in the GraphQL list and tab.
    profile.entrypoint.type = GRAPHQL_ENTRYPOINT_TYPE;
    const data = profile.entrypoint.data;
    // Idempotent: only the first resolver of a request captures the operation —
    // the interceptor calls this for every resolver.
    if (data.graphql) return;

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

    data.graphql = {
      operationType,
      fieldName,
      ...(operationName !== undefined && { operationName }),
      ...(query !== undefined && { query: tryFormatQuery(query) }),
      ...(variables !== undefined && { variables }),
    };
  }

  /** Populates GraphQL metadata and surfaces errors even when no resolver ran (e.g. validation failure). */
  enrichHttpResponse(profile: Profile<HttpRequestData>, req: object, responseBody: unknown): void {
    const data = profile.entrypoint.data;
    const reqRecord = req as Record<string, unknown>;
    // Apollo may parse body internally — fall back to profiler-captured body.
    const body =
      (reqRecord['body'] as Record<string, unknown> | undefined) ??
      (data.body as Record<string, unknown> | undefined);
    if (!body || typeof body['query'] !== 'string') return;

    // Confirmed GraphQL even when no resolver ran (e.g. a validation failure):
    // promote it to the GraphQL entrypoint kind.
    profile.entrypoint.type = GRAPHQL_ENTRYPOINT_TYPE;

    const rawQuery = body['query'];

    if (!data.graphql) {
      // No resolver ran (e.g. validation failure) — populate metadata from HTTP body.
      const { operationType, fieldName, query } = extractQueryMetadata(rawQuery);
      data.graphql = {
        operationType,
        fieldName,
        ...(typeof body['operationName'] === 'string' && { operationName: body['operationName'] }),
        query,
        ...(body['variables'] !== null &&
          body['variables'] !== undefined &&
          typeof body['variables'] === 'object' && {
            variables: body['variables'] as Record<string, unknown>,
          }),
      };
    } else if (data.graphql.query) {
      // Resolver ran — still format the query for consistent display.
      data.graphql = {
        ...data.graphql,
        query: tryFormatQuery(data.graphql.query),
      };
    }

    const gqlResponse = responseBody as { errors?: unknown[] } | null;
    if (!Array.isArray(gqlResponse?.errors)) return;

    for (const err of gqlResponse.errors) {
      const errObj = err as Record<string, unknown> | null;
      if (!errObj || typeof errObj['message'] !== 'string') continue;

      const extensions = errObj['extensions'] as Record<string, unknown> | undefined;
      const code = extensions?.['code'];

      const entry: ExceptionEntry = {
        // GraphQL answers `200` and flattens every failure into `errors`, so the class name
        // carries no information — `extensions.code` is what actually discriminates, and it is
        // what the error classification and the `exception` filter key on.
        name: 'GraphQLError',
        message: errObj['message'],
        ...(typeof code === 'string' ? { code } : {}),
        timestamp: Date.now(),
      };

      const parts: string[] = [];
      if (errObj['locations']) parts.push(`Locations: ${JSON.stringify(errObj['locations'])}`);
      if (extensions) parts.push(`Extensions: ${JSON.stringify(extensions)}`);
      if (parts.length > 0) entry.stack = parts.join('\n');

      profile.exceptions.push(entry);
    }
  }
}
