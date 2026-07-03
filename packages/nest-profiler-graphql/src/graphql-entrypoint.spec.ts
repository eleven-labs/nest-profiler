import type { Profile } from '@eleven-labs/nest-profiler';
import { matchesCriterion, summarizeProfile } from '@eleven-labs/nest-profiler';
import { GRAPHQL_ENTRYPOINT_TYPE, GRAPHQL_ENTRYPOINT_TYPE_DEF } from './graphql-entrypoint';
import type { GraphQLEntrypointData } from './graphql-entrypoint';

const attrs = (p: Profile): Record<string, string | number | boolean> =>
  GRAPHQL_ENTRYPOINT_TYPE_DEF.indexAttributes?.(p) ?? {};

/** Applies a filter through the declarative path: parse → criterion → evaluate on the summary. */
function applies(key: string, value: string, profile: Profile): boolean {
  const filter = GRAPHQL_ENTRYPOINT_TYPE_DEF.listFilters?.find((f) => f.key === key);
  return matchesCriterion(summarizeProfile(profile, attrs), filter!.toCriterion(value));
}

function makeProfile(
  data: Partial<GraphQLEntrypointData['graphql']> = {},
): Profile<GraphQLEntrypointData> {
  return {
    token: 'tok',
    createdAt: 0,
    entrypoint: {
      type: GRAPHQL_ENTRYPOINT_TYPE,
      data: {
        method: 'POST',
        url: '/graphql',
        headers: {},
        query: {},
        graphql: { operationType: 'query', fieldName: 'books', ...data },
      },
    },
    performance: { startTime: 0, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

describe('GRAPHQL_ENTRYPOINT_TYPE_DEF', () => {
  it('describes the graphql entrypoint type', () => {
    expect(GRAPHQL_ENTRYPOINT_TYPE_DEF.type).toBe(GRAPHQL_ENTRYPOINT_TYPE);
    expect(GRAPHQL_ENTRYPOINT_TYPE_DEF.label).toBe('GraphQL');
    expect(GRAPHQL_ENTRYPOINT_TYPE_DEF.listSection.templatePath).toMatch(/graphql-section\.ejs$/);
    expect(GRAPHQL_ENTRYPOINT_TYPE_DEF.detailTabs[0]?.templatePath).toMatch(/graphql-detail\.ejs$/);
  });

  describe('summary', () => {
    it('uses the operation name when present', () => {
      const profile = makeProfile({ operationType: 'mutation', operationName: 'CreateBook' });
      expect(GRAPHQL_ENTRYPOINT_TYPE_DEF.summary(profile)).toEqual({
        badge: 'GQL',
        badgeClass: 'badge-default',
        text: 'MUTATION CreateBook',
      });
    });

    it('falls back to the field name when there is no operation name', () => {
      expect(GRAPHQL_ENTRYPOINT_TYPE_DEF.summary(makeProfile()).text).toBe('QUERY books');
    });
  });

  describe('operationType filter', () => {
    const filter = GRAPHQL_ENTRYPOINT_TYPE_DEF.listFilters?.find((f) => f.key === 'operationType');

    it('matches profiles by their operation type (via the indexed attribute)', () => {
      expect(applies('operationType', 'mutation', makeProfile({ operationType: 'mutation' }))).toBe(
        true,
      );
      expect(applies('operationType', 'mutation', makeProfile({ operationType: 'query' }))).toBe(
        false,
      );
    });

    it('indexes operationType as a queryable attribute', () => {
      expect(
        GRAPHQL_ENTRYPOINT_TYPE_DEF.indexAttributes?.(makeProfile({ operationType: 'query' })),
      ).toEqual({ operationType: 'query' });
    });

    it('is inactive for an empty value', () => {
      expect(filter?.parse('')).toBeUndefined();
    });

    it('keeps a non-empty value as the active filter', () => {
      expect(filter?.parse('mutation')).toBe('mutation');
    });
  });
});
