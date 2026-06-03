import { Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { IContextAdapter } from './context-adapter.interface';
import type { GraphQLInfo, Profile } from '../interfaces/profile.interface';
import { PROFILER_REQ_KEY } from '../constants';

type GqlResolveInfo = {
  fieldName?: string;
  operation?: { operation?: 'query' | 'mutation' | 'subscription' };
};

type GqlContext = Record<string, unknown>;

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
      ...(query !== undefined && { query }),
      ...(variables !== undefined && { variables }),
    };
  }
}
