import type { Profile } from '@eleven-labs/nest-profiler';
import { GraphqlFieldTraceContributor } from './graphql-field-trace.contributor';
import { GRAPHQL_FIELD_SPANS_KEY, type GraphqlFieldSpan } from './graphql-field-span';

function makeProfile(spans?: GraphqlFieldSpan[]): Profile {
  return {
    token: 't',
    createdAt: 0,
    entrypoint: { type: 'graphql', data: {} },
    performance: { startTime: 0, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: spans ? { [GRAPHQL_FIELD_SPANS_KEY]: spans } : {},
  };
}

describe('GraphqlFieldTraceContributor', () => {
  const contributor = new GraphqlFieldTraceContributor();

  it('maps accumulated field spans to graphql-field raw spans and drains the key', () => {
    const profile = makeProfile([
      {
        id: 'f1',
        parentId: 'root',
        label: 'Query.products',
        startedAt: 5,
        duration: 10,
        status: 'ok',
      },
    ]);
    expect(contributor.getTraceSpans(profile)).toEqual([
      {
        id: 'f1',
        parentId: 'root',
        kind: 'graphql-field',
        label: 'Query.products',
        startedAt: 5,
        duration: 10,
        status: 'ok',
      },
    ]);
    expect(profile.collectors[GRAPHQL_FIELD_SPANS_KEY]).toBeUndefined();
  });

  it('returns an empty array when no field spans were recorded', () => {
    expect(contributor.getTraceSpans(makeProfile())).toEqual([]);
  });
});
