import * as path from 'path';
import type {
  EntrypointSummary,
  GraphQLInfo,
  HttpRequestData,
  Profile,
  ProfilerEntrypointType,
  ProfilerListFilter,
} from '@eleven-labs/nest-profiler';

/** `Profile.entrypoint.type` value for GraphQL operations (HTTP transport). */
export const GRAPHQL_ENTRYPOINT_TYPE = 'graphql';

/**
 * Payload of the `graphql` entrypoint. A GraphQL operation is still carried by an
 * HTTP request, so it extends {@link HttpRequestData} with a guaranteed
 * {@link GraphQLInfo} — the operation metadata the adapter captures.
 */
export interface GraphQLEntrypointData extends HttpRequestData {
  graphql: GraphQLInfo;
}

const TEMPLATES_DIR = path.join(__dirname, 'templates');

/** GraphQL-only filter: narrows the GraphQL list by operation type. */
const operationTypeFilter: ProfilerListFilter<string> = {
  key: 'operationType',
  label: 'Operation',
  control: 'select',
  order: 20,
  options: [
    { value: '', label: 'All' },
    { value: 'query', label: 'Query' },
    { value: 'mutation', label: 'Mutation' },
    { value: 'subscription', label: 'Subscription' },
  ],
  parse: (raw) => (typeof raw === 'string' && raw.length > 0 ? raw : undefined),
  toCriterion: (value) => ({ field: 'attributes.operationType', op: 'eq', value }),
};

const GRAPHQL_ICON =
  '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"/></svg>';

/**
 * The `graphql` entrypoint: GraphQL operations render in their own list table
 * and on a dedicated "GraphQL" detail tab (operation, query, variables and the
 * response envelope). Registered by {@link GraphQLCollectorModule}, which also
 * installs the context adapter that flips an HTTP profile's `entrypoint.type` to
 * `graphql` once it carries an operation.
 */
export const GRAPHQL_ENTRYPOINT_TYPE_DEF: ProfilerEntrypointType = {
  type: GRAPHQL_ENTRYPOINT_TYPE,
  label: 'GraphQL',
  listSection: {
    title: 'GraphQL',
    description: 'GraphQL operations captured by the profiler',
    // Between the built-in HTTP section (10) and the commander section (20).
    order: 15,
    itemLabel: 'operation',
    templatePath: path.join(TEMPLATES_DIR, 'graphql-section.ejs'),
  },
  detailTabs: [
    {
      name: 'graphql',
      label: 'GraphQL',
      icon: GRAPHQL_ICON,
      templatePath: path.join(TEMPLATES_DIR, 'graphql-detail.ejs'),
    },
  ],
  listFilters: [operationTypeFilter],
  indexAttributes: (profile: Profile<GraphQLEntrypointData>) => ({
    operationType: profile.entrypoint.data.graphql.operationType,
  }),
  summary(profile: Profile<GraphQLEntrypointData>): EntrypointSummary {
    const gql = profile.entrypoint.data.graphql;
    return {
      badge: 'GQL',
      badgeClass: 'badge-default',
      text: `${gql.operationType.toUpperCase()} ${gql.operationName ?? gql.fieldName}`,
    };
  },
};
