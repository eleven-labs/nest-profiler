import * as path from 'path';
import { buildCurlCommand } from './copy/build-curl';
import { interpolateSql } from '../collectors/sql/interpolate-sql';
import { safeStringify } from '../utils/safe-data.utils';

export const TEMPLATES_DIR = path.join(__dirname, '../templates');

/** Directory holding built static assets (compiled Tailwind CSS, vendored highlight.js). */
export const PUBLIC_DIR = path.join(__dirname, '../public');

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map((item) => JSON.stringify(item) ?? '').join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

// Semantic class names — defined in @layer utilities inside _head.ejs
const METHOD_CLASSES: Record<string, string> = {
  GET: 'badge-get',
  POST: 'badge-post',
  PUT: 'badge-put',
  PATCH: 'badge-patch',
  DELETE: 'badge-delete',
  HEAD: 'badge-head',
  OPTIONS: 'badge-options',
};

const GQL_TYPE_CLASSES: Record<string, string> = {
  query: 'badge-gql-query',
  mutation: 'badge-gql-mutation',
  subscription: 'badge-gql-subscription',
};

const LOG_LEVEL_CLASSES: Record<string, string> = {
  log: 'badge-log',
  warn: 'badge-warn',
  error: 'badge-error',
  debug: 'badge-debug',
  verbose: 'badge-verbose',
  fatal: 'badge-fatal',
};

/** Per-tag-id badge classes; custom tag ids fall back to a severity-based class. */
const TAG_CLASSES: Record<string, string> = {
  slow: 'badge-tag-slow',
  'n-plus-one': 'badge-tag-n-plus-one',
  error: 'badge-tag-error',
  chatty: 'badge-tag-chatty',
  'large-payload': 'badge-tag-large-payload',
};

/**
 * Severity fallback classes for custom tag ids. Kept as literals (not interpolated)
 * so Tailwind's content scan of this file emits them.
 */
const TAG_SEVERITY_CLASSES: Record<string, string> = {
  info: 'badge-tag-info',
  warning: 'badge-tag-warning',
  danger: 'badge-tag-danger',
};

/** A structured performance tag as passed to {@link HELPERS.tagBadge}. */
interface TagLike {
  id: string;
  label: string;
  severity: 'info' | 'warning' | 'danger';
  count?: number;
  detail?: string;
}

const SQL_KEYWORDS =
  /\b(SELECT|FROM|WHERE|JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|INNER\s+JOIN|OUTER\s+JOIN|FULL\s+JOIN|CROSS\s+JOIN|ON|AND|OR|NOT|IN|EXISTS|IS|NULL|INSERT|INTO|VALUES|UPDATE|SET|DELETE|ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|AS|DISTINCT|COUNT|SUM|AVG|MIN|MAX|CASE|WHEN|THEN|ELSE|END|UNION|ALL|WITH|CREATE|TABLE|INDEX|DROP|ALTER|ADD|CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|REFERENCES|BEGIN|COMMIT|ROLLBACK|TRANSACTION|RETURNING)\b/gi;

const COPY_ICON =
  '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>';

export const HELPERS = {
  methodClass: (method: string): string => METHOD_CLASSES[method] ?? 'badge-default',
  buildCurl: buildCurlCommand,
  interpolateSql,
  // Returns safe HTML — use <%- copyBtn(...) %> in templates. The text is
  // base64-encoded (UTF-8) into `data-copy` so any payload (multi-line, quotes,
  // unicode) survives without HTML-escaping concerns. The client bundle's copy
  // behaviour (src/client/behaviors/copy.ts) binds `[data-copy]` via delegation
  // and stops propagation so a nested button never toggles an expandable row.
  copyBtn: (text: string, label = 'Copy'): string => {
    const encoded = Buffer.from(text ?? '', 'utf8').toString('base64');
    return (
      `<button type="button" data-copy="${encoded}" data-copy-label="${escapeHtml(label)}" ` +
      `class="inline-flex items-center gap-1 px-2 py-1 rounded text-2xs font-medium border border-line ` +
      `text-foreground-muted hover:bg-surface-muted hover:text-foreground transition-colors">` +
      `${COPY_ICON}<span data-copy-text>${escapeHtml(label)}</span></button>`
    );
  },
  gqlTypeClass: (operationType: string): string =>
    GQL_TYPE_CLASSES[operationType.toLowerCase()] ?? 'badge-default',
  statusClass: (status: number): string => {
    if (status < 300) return 'badge-2xx';
    if (status < 400) return 'badge-3xx';
    if (status < 500) return 'badge-4xx';
    return 'badge-5xx';
  },
  logLevelClass: (level: string): string => LOG_LEVEL_CLASSES[level] ?? 'badge-default',
  tagClass: (tag: TagLike): string =>
    TAG_CLASSES[tag.id] ?? TAG_SEVERITY_CLASSES[tag.severity] ?? 'badge-default',
  // Returns safe HTML — use <%- tagBadge(tag) %> in templates. Renders one performance-tag
  // pill; `detail` becomes the hover tooltip.
  tagBadge: (tag: TagLike): string => {
    const cls = TAG_CLASSES[tag.id] ?? TAG_SEVERITY_CLASSES[tag.severity] ?? 'badge-default';
    const title = tag.detail ? ` title="${escapeHtml(tag.detail)}"` : '';
    return (
      `<span class="px-1.5 py-0.5 rounded text-2xs font-bold tracking-wide ${cls}"${title}>` +
      `${escapeHtml(tag.label)}</span>`
    );
  },
  // Returns safe HTML — use <%- tagBadges(tags) %>. Renders a space-separated row of pills,
  // or an empty string when there are none.
  tagBadges: (tags: TagLike[] | undefined): string =>
    (tags ?? []).map((tag) => HELPERS.tagBadge(tag)).join(' '),
  mb: (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(2)} MB`,
  isoDate: (ts: number): string => new Date(ts).toISOString().replace('T', ' ').slice(0, 19),
  timeOnly: (ts: number): string => new Date(ts).toISOString().slice(11, 23),
  // Defensive: a captured body/log payload may contain circular references or BigInt, both of
  // which make a raw JSON.stringify throw and 500 the detail page. safeStringify never throws.
  toJson: (val: unknown): string => safeStringify(val, 2),
  highlightSql: (sql: string): string =>
    escapeHtml(sql).replace(SQL_KEYWORDS, '<span class="sql-keyword">$&</span>'),
  // Returns safe HTML — use <%- kvTable(...) %> in templates
  kvTable: (data: Record<string, unknown>): string => {
    const entries = Object.entries(data);
    if (entries.length === 0)
      return '<p class="text-foreground-faint text-xs italic py-1">Empty</p>';
    const rows = entries
      .map(
        ([k, v]) =>
          `<tr class="border-b border-line-subtle last:border-0 hover:bg-surface-muted transition-colors">` +
          `<td class="py-2 px-4 text-foreground-muted text-xs font-mono whitespace-nowrap align-top w-1/4">${escapeHtml(k)}</td>` +
          `<td class="py-2 px-4 text-foreground text-xs font-mono break-all">${escapeHtml(toStr(v))}</td>` +
          `</tr>`,
      )
      .join('');
    return (
      `<div class="rounded-lg border border-line overflow-hidden">` +
      `<table class="w-full"><tbody>${rows}</tbody></table></div>`
    );
  },
};
