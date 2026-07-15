import type { ProfilerListFilter } from './profiler-list-filter.interface';
import { parseLenientInt } from './list-filter.utils';
import { BUILTIN_TAG_IDS } from '../analysis/profiler-tag.interface';

/** Free-text search across URL, GraphQL operation/field name and command name. */
const searchFilter: ProfilerListFilter<string> = {
  key: 'q',
  label: 'Search',
  control: 'text',
  order: 30,
  placeholder: '/api/…, operation, command',
  parse: (raw) => (typeof raw === 'string' && raw.length > 0 ? raw.toLowerCase() : undefined),
  toCriterion: (value) => ({ field: 'search', op: 'contains', value }),
};

/**
 * The entrypoint kinds the HTTP-status filters apply to: those that carry an HTTP
 * `response`. REST (`http`) and GraphQL (`graphql`, which rides on HTTP) qualify;
 * `command` and `rabbitmq` profiles have no response, so the status filters are
 * hidden from their lists rather than shown inert.
 */
const HTTP_RESPONSE_TYPES = ['http', 'graphql'] as const;

const statusFilter: ProfilerListFilter<number> = {
  key: 'status',
  label: 'Status',
  control: 'number',
  order: 40,
  forType: HTTP_RESPONSE_TYPES,
  placeholder: '200',
  parse: parseLenientInt,
  toCriterion: (value) => ({ field: 'statusCode', op: 'eq', value }),
};

const statusClassFilter: ProfilerListFilter<number> = {
  key: 'statusClass',
  label: 'Status class',
  control: 'select',
  order: 50,
  forType: HTTP_RESPONSE_TYPES,
  options: [
    { value: '', label: 'All' },
    { value: '2', label: '2xx' },
    { value: '3', label: '3xx' },
    { value: '4', label: '4xx' },
    { value: '5', label: '5xx' },
  ],
  parse: (raw) => {
    const parsed = parseLenientInt(raw);
    return parsed !== undefined && parsed >= 1 && parsed <= 5 ? parsed : undefined;
  },
  // e.g. class 4 → statusCode in [400, 499].
  toCriterion: (value) => ({
    field: 'statusCode',
    op: 'range',
    value: [value * 100, value * 100 + 99],
  }),
};

const minDurationFilter: ProfilerListFilter<number> = {
  key: 'minDuration',
  label: 'Min duration (ms)',
  control: 'number',
  order: 60,
  placeholder: '0',
  parse: parseLenientInt,
  toCriterion: (value) => ({ field: 'duration', op: 'gte', value }),
};

const maxDurationFilter: ProfilerListFilter<number> = {
  key: 'maxDuration',
  label: 'Max duration (ms)',
  control: 'number',
  order: 70,
  placeholder: '—',
  parse: parseLenientInt,
  toCriterion: (value) => ({ field: 'duration', op: 'lte', value }),
};

/**
 * Filters profiles by a genuine performance tag applied by the rule engine —
 * `slow`, `n-plus-one`, `chatty`, `large-payload` or `zero-rows`. Failures are not performance
 * issues, so the `error` tag has its own checkbox ({@link errorFilter}). The value
 * is space-wrapped so a `contains` criterion matches a whole id in the summary's
 * space-delimited `tags` haystack (`slow` never matches `very-slow`). Custom tag
 * ids can be offered via {@link ProfilerCoreService.registerFilterOption}(`'tag'`, …).
 */
const tagFilter: ProfilerListFilter<string> = {
  key: 'tag',
  label: 'Performance tag',
  control: 'select',
  order: 80,
  options: [
    { value: '', label: 'All' },
    { value: BUILTIN_TAG_IDS.slow, label: 'Slow' },
    { value: BUILTIN_TAG_IDS.nPlusOne, label: 'N+1' },
    { value: BUILTIN_TAG_IDS.chatty, label: 'Chatty' },
    { value: BUILTIN_TAG_IDS.largePayload, label: 'Large payload' },
    { value: BUILTIN_TAG_IDS.zeroRows, label: 'No rows' },
  ],
  parse: (raw) => (typeof raw === 'string' && raw.length > 0 ? raw : undefined),
  toCriterion: (value) => ({ field: 'tags', op: 'contains', value: ` ${value} ` }),
};

/**
 * Narrows the list to one failure type — the exception class actually captured
 * (`NotFoundException`, `TypeError`) or, where the protocol carries one, its error code (a
 * GraphQL `BAD_USER_INPUT`). The options are the distinct values present in the store, scoped
 * to the section's kind, so each list offers only what it has really seen.
 *
 * Complements {@link errorFilter} rather than duplicating it: the checkbox answers "what failed,
 * per my definition of failure" — which is configurable and may well exclude a captured
 * `NotFoundException` — while this select answers "show me the `NotFoundException`s",
 * independently of whether they count as errors.
 */
const exceptionFilter: ProfilerListFilter<string> = {
  key: 'exception',
  label: 'Exception',
  control: 'select',
  order: 84,
  distinctField: 'attributes.exception',
  parse: (raw) => (typeof raw === 'string' && raw.length > 0 ? raw : undefined),
  toCriterion: (value) => ({ field: 'attributes.exception', op: 'eq', value }),
};

/**
 * Keeps only profiles that carry the `error` tag — a failure per the entrypoint kind's own
 * definition (a 5xx for HTTP, an `INTERNAL_SERVER_ERROR` for GraphQL, a non-zero exit for a
 * command), or a failed call among the profile's collected entries. What counts is configurable
 * per package via its `error` option, so this checkbox follows the host's definition rather than
 * imposing one.
 *
 * Kept separate from the performance tag select since a failure is not a performance issue. A
 * kind whose list already carries an equivalent control hides it via `hiddenFilters`.
 */
const errorFilter: ProfilerListFilter<boolean> = {
  key: 'error',
  label: 'Errors',
  control: 'checkbox',
  order: 85,
  // Checked boxes submit '1'; unchecked submit nothing — undefined keeps the filter inactive.
  parse: (raw) => (typeof raw === 'string' && raw.length > 0 ? true : undefined),
  toCriterion: () => ({ field: 'tags', op: 'contains', value: ` ${BUILTIN_TAG_IDS.error} ` }),
};

/**
 * The filters the core registers by default (in display order). Most are
 * universal — search, duration and the performance tag apply to every list —
 * while the HTTP-status pair (`status`, `statusClass`) is scoped via `forType`
 * to the response-producing kinds ({@link HTTP_RESPONSE_TYPES}). Kind-specific
 * filters (HTTP method, GraphQL operation type, RabbitMQ delivery…) are
 * contributed by each entrypoint type and shown only above its own list.
 */
export const BUILTIN_LIST_FILTERS: ProfilerListFilter[] = [
  searchFilter,
  statusFilter,
  statusClassFilter,
  minDurationFilter,
  maxDurationFilter,
  tagFilter,
  exceptionFilter,
  errorFilter,
];
