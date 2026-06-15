import * as path from 'path';
import type { HttpRequestData, Profile } from '../interfaces/profile.interface';
import { HTTP_ENTRYPOINT_TYPE } from '../interfaces/profile.interface';
import { HELPERS } from '../views/template-engine';
import type { ProfilerListFilter } from '../list-filters/profiler-list-filter.interface';
import type {
  EntrypointSummary,
  ProfilerEntrypointType,
} from './profiler-entrypoint-type.interface';

const SECTIONS_DIR = path.join(__dirname, '../templates/sections');
const ENTRYPOINTS_DIR = path.join(__dirname, '../templates/entrypoints');

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

/** HTTP-only filter: narrows the HTTP list by request method. */
export const methodFilter: ProfilerListFilter<string> = {
  key: 'method',
  label: 'Method',
  control: 'select',
  order: 20,
  options: [{ value: '', label: 'All' }, ...HTTP_METHODS.map((m) => ({ value: m, label: m }))],
  parse: (raw) => (typeof raw === 'string' && raw.length > 0 ? raw : undefined),
  matches: (profile: Profile<HttpRequestData>, value) =>
    profile.entrypoint.data.method?.toUpperCase() === value.toUpperCase(),
};

const REQUEST_ICON =
  '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/></svg>';
const RESPONSE_ICON =
  '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>';

/**
 * The built-in HTTP entrypoint, covering REST requests. It is the catch-all
 * (`isDefault`): any profile whose `entrypoint.type` matches no registered type
 * renders here. GraphQL rides on HTTP but is its own entrypoint kind, contributed
 * by `@eleven-labs/nest-profiler-graphql` with its own list table and detail tab.
 */
export const HTTP_ENTRYPOINT_TYPE_DEF: ProfilerEntrypointType = {
  type: HTTP_ENTRYPOINT_TYPE,
  label: 'HTTP',
  isDefault: true,
  // The `http` option is seeded directly on the built-in `type` filter, so no
  // `typeFilterOption` is contributed here.
  listSection: {
    title: 'HTTP',
    description: 'HTTP requests captured by the profiler',
    order: 10,
    itemLabel: 'request',
    templatePath: path.join(SECTIONS_DIR, 'requests-section.ejs'),
  },
  detailTabs: [
    {
      name: 'request',
      label: 'Request',
      icon: REQUEST_ICON,
      templatePath: path.join(ENTRYPOINTS_DIR, 'http-request.ejs'),
    },
    {
      name: 'response',
      label: 'Response',
      icon: RESPONSE_ICON,
      templatePath: path.join(ENTRYPOINTS_DIR, 'http-response.ejs'),
    },
  ],
  listFilters: [methodFilter],
  summary(profile: Profile<HttpRequestData>): EntrypointSummary {
    const data = profile.entrypoint.data;
    return {
      badge: data.method,
      badgeClass: HELPERS.methodClass(data.method),
      text: data.url,
    };
  },
};
