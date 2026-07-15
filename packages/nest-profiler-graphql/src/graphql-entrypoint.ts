import * as path from 'path';
import type {
  EntrypointSummary,
  GraphQLInfo,
  HttpRequestData,
  Profile,
  ProfilerEntrypointType,
  ProfilerErrorOptions,
  ProfilerListFilter,
} from '@eleven-labs/nest-profiler';
import { resolveErrorSeverity, resolveProfileErrorClassifier } from '@eleven-labs/nest-profiler';

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
 * The GraphQL error codes that count as a failure by default — the spec-standard code Apollo
 * and Mercurius give an unexpected server-side throw. Every other code (`BAD_REQUEST`, which the
 * Nest Apollo driver emits when validation rejects a mutation, plus `BAD_USER_INPUT`,
 * `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`…) describes a client mistake the schema answered
 * correctly, which is GraphQL's equivalent of a 4xx — an answer, not an error. An error with no
 * code at all counts too: an unmapped throw is a genuine failure.
 */
const DEFAULT_ERROR_CODES = ['INTERNAL_SERVER_ERROR'];

/**
 * GraphQL's baseline: the transport status is `200` even for a failed operation — the failure
 * lives in `errors`. So the status layer is off and `extensions.code` is the verdict, playing
 * exactly the role a status code plays for REST.
 */
const GRAPHQL_ERROR_DEFAULTS: ProfilerErrorOptions = {
  httpStatus: false,
  codes: DEFAULT_ERROR_CODES,
};

/**
 * The `graphql` entrypoint: GraphQL operations render in their own list table
 * and on a dedicated "GraphQL" detail tab (operation, query, variables and the
 * response envelope). Registered by {@link GraphQLCollectorModule}, which also
 * installs the context adapter that flips an HTTP profile's `entrypoint.type` to
 * `graphql` once it carries an operation.
 *
 * Carries the default error classification; {@link GraphQLCollectorModule} registers a
 * configured one via {@link buildGraphqlEntrypointType}.
 */
export const GRAPHQL_ENTRYPOINT_TYPE_DEF: ProfilerEntrypointType = {
  type: GRAPHQL_ENTRYPOINT_TYPE,
  label: 'GraphQL',
  isError: resolveProfileErrorClassifier(undefined, GRAPHQL_ERROR_DEFAULTS),
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

/**
 * The GraphQL entrypoint with a host-supplied error classification.
 *
 * ```ts
 * // Here, a failed login is an incident worth surfacing.
 * GraphQLCollectorModule.forRoot({
 *   error: { codes: ['INTERNAL_SERVER_ERROR', 'UNAUTHENTICATED'] },
 * });
 * ```
 *
 * @param error - What counts as a failed operation, from `GraphQLCollectorModuleOptions.error`.
 *   Merged over {@link GRAPHQL_ERROR_DEFAULTS} key by key, so overriding `codes` keeps the
 *   status layer off unless you deliberately re-enable it.
 */
export function buildGraphqlEntrypointType(error?: ProfilerErrorOptions): ProfilerEntrypointType {
  return {
    ...GRAPHQL_ENTRYPOINT_TYPE_DEF,
    isError: resolveProfileErrorClassifier(error, GRAPHQL_ERROR_DEFAULTS),
    errorSeverity: resolveErrorSeverity(error),
  };
}
