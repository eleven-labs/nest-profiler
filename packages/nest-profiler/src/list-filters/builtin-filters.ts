import type { ProfilerListFilter } from './profiler-list-filter.interface';
import { parseLenientInt } from './list-filter.utils';

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

const hasExceptionsFilter: ProfilerListFilter<boolean> = {
  key: 'hasExceptions',
  label: 'With exceptions',
  control: 'checkbox',
  order: 80,
  // Checked boxes submit '1'; unchecked submit nothing — undefined keeps the filter inactive.
  parse: (raw) => (typeof raw === 'string' && raw.length > 0 ? true : undefined),
  toCriterion: () => ({ field: 'hasExceptions', op: 'truthy' }),
};

/**
 * The filters the core registers by default (in display order). Most are
 * universal — search, duration and exceptions apply to every list — while the
 * HTTP-status pair (`status`, `statusClass`) is scoped via `forType` to the
 * response-producing kinds ({@link HTTP_RESPONSE_TYPES}). Kind-specific filters
 * (HTTP method, GraphQL operation type, RabbitMQ delivery…) are contributed by
 * each entrypoint type and shown only above its own list.
 */
export const BUILTIN_LIST_FILTERS: ProfilerListFilter[] = [
  searchFilter,
  statusFilter,
  statusClassFilter,
  minDurationFilter,
  maxDurationFilter,
  hasExceptionsFilter,
];
