import type { Profile } from '../interfaces/profile.interface';
import type { ProfilerListFilter } from './profiler-list-filter.interface';
import { parseLenientInt } from './list-filter.utils';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

/** Lowercased haystack of everything the global search scans for a profile. */
function searchHaystack(profile: Profile): string {
  const { url, graphql, command } = profile.request;
  return [url, graphql?.operationName, graphql?.fieldName, command?.name]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase();
}

/**
 * Request kind — HTTP (REST), GraphQL and CLI commands are mutually exclusive.
 * The core ships the `http` and `command` options; protocol packages add their
 * own (e.g. `@eleven-labs/nest-profiler-graphql` registers a `graphql` option
 * via {@link ProfilerCoreService.registerFilterOption}). Matching for `graphql`
 * lives here because `request.graphql` is a core Profile field.
 */
const typeFilter: ProfilerListFilter<string> = {
  key: 'type',
  label: 'Type',
  control: 'select',
  order: 10,
  options: [
    { value: '', label: 'All' },
    { value: 'http', label: 'HTTP' },
    { value: 'command', label: 'Command' },
  ],
  // Accept any non-empty value so options contributed by other packages work.
  parse: (raw) => (typeof raw === 'string' && raw.length > 0 ? raw : undefined),
  matches: (profile, value) => {
    const { graphql, command } = profile.request;
    switch (value) {
      case 'command':
        return command !== undefined;
      case 'graphql':
        return graphql !== undefined;
      // 'http' means a plain REST request: neither a GraphQL operation nor a command.
      case 'http':
        return graphql === undefined && command === undefined;
      default:
        return false;
    }
  },
};

const methodFilter: ProfilerListFilter<string> = {
  key: 'method',
  label: 'Method',
  control: 'select',
  order: 20,
  options: [{ value: '', label: 'All' }, ...HTTP_METHODS.map((m) => ({ value: m, label: m }))],
  parse: (raw) => (typeof raw === 'string' && raw.length > 0 ? raw : undefined),
  matches: (profile, value) => profile.request.method.toUpperCase() === value.toUpperCase(),
};

/** Free-text search across URL, GraphQL operation/field name and command name. */
const searchFilter: ProfilerListFilter<string> = {
  key: 'q',
  label: 'Search',
  control: 'text',
  order: 30,
  placeholder: '/api/…, operation, command',
  parse: (raw) => (typeof raw === 'string' && raw.length > 0 ? raw.toLowerCase() : undefined),
  matches: (profile, value) => searchHaystack(profile).includes(value),
};

const statusFilter: ProfilerListFilter<number> = {
  key: 'status',
  label: 'Status',
  control: 'number',
  order: 40,
  placeholder: '200',
  parse: parseLenientInt,
  matches: (profile, value) => profile.response?.statusCode === value,
};

const statusClassFilter: ProfilerListFilter<number> = {
  key: 'statusClass',
  label: 'Status class',
  control: 'select',
  order: 50,
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
  matches: (profile, value) =>
    profile.response !== undefined && Math.floor(profile.response.statusCode / 100) === value,
};

const minDurationFilter: ProfilerListFilter<number> = {
  key: 'minDuration',
  label: 'Min duration (ms)',
  control: 'number',
  order: 60,
  placeholder: '0',
  parse: parseLenientInt,
  matches: (profile, value) => (profile.performance.duration ?? 0) >= value,
};

const maxDurationFilter: ProfilerListFilter<number> = {
  key: 'maxDuration',
  label: 'Max duration (ms)',
  control: 'number',
  order: 70,
  placeholder: '—',
  parse: parseLenientInt,
  matches: (profile, value) => (profile.performance.duration ?? 0) <= value,
};

const hasExceptionsFilter: ProfilerListFilter<boolean> = {
  key: 'hasExceptions',
  label: 'With exceptions',
  control: 'checkbox',
  order: 80,
  // Checked boxes submit '1'; unchecked submit nothing — undefined keeps the filter inactive.
  parse: (raw) => (typeof raw === 'string' && raw.length > 0 ? true : undefined),
  matches: (profile) => profile.exceptions.length > 0,
};

/** The filters the core registers by default, in display order. */
export const BUILTIN_LIST_FILTERS: ProfilerListFilter[] = [
  typeFilter,
  methodFilter,
  searchFilter,
  statusFilter,
  statusClassFilter,
  minDurationFilter,
  maxDurationFilter,
  hasExceptionsFilter,
];
