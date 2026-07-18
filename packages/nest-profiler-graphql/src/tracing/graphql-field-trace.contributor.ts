import { getCollectorEntries } from '@eleven-labs/nest-profiler';
import type { Profile, RawSpan, TraceContributor } from '@eleven-labs/nest-profiler';
import { GRAPHQL_FIELD_SPANS_KEY } from './graphql-field-span';
import type { GraphqlFieldSpan } from './graphql-field-span';

/**
 * Feeds the field spans the middleware accumulated into the unified trace. Drains the
 * private key at `buildTrace` time (after every resolver has run), so a field's own
 * `startedAt`/`duration` and its captured `parentId` land as `graphql-field` spans.
 */
export class GraphqlFieldTraceContributor implements TraceContributor {
  getTraceSpans(profile: Profile): RawSpan[] {
    const spans = getCollectorEntries<GraphqlFieldSpan>(profile, GRAPHQL_FIELD_SPANS_KEY);
    delete profile.collectors[GRAPHQL_FIELD_SPANS_KEY];
    return spans.map((span) => ({
      id: span.id,
      parentId: span.parentId,
      kind: 'graphql-field',
      label: span.label,
      startedAt: span.startedAt,
      duration: span.duration,
      status: span.status,
    }));
  }
}
