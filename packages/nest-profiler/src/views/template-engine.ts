import * as path from 'path';

export const TEMPLATES_DIR = path.join(__dirname, '../templates');

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

const SQL_KEYWORDS =
  /\b(SELECT|FROM|WHERE|JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|INNER\s+JOIN|OUTER\s+JOIN|FULL\s+JOIN|CROSS\s+JOIN|ON|AND|OR|NOT|IN|EXISTS|IS|NULL|INSERT|INTO|VALUES|UPDATE|SET|DELETE|ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|AS|DISTINCT|COUNT|SUM|AVG|MIN|MAX|CASE|WHEN|THEN|ELSE|END|UNION|ALL|WITH|CREATE|TABLE|INDEX|DROP|ALTER|ADD|CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|REFERENCES|BEGIN|COMMIT|ROLLBACK|TRANSACTION|RETURNING)\b/gi;

export const HELPERS = {
  methodClass: (method: string): string => METHOD_CLASSES[method] ?? 'badge-default',
  gqlTypeClass: (operationType: string): string =>
    GQL_TYPE_CLASSES[operationType.toLowerCase()] ?? 'badge-default',
  statusClass: (status: number): string => {
    if (status < 300) return 'badge-2xx';
    if (status < 400) return 'badge-3xx';
    if (status < 500) return 'badge-4xx';
    return 'badge-5xx';
  },
  logLevelClass: (level: string): string => LOG_LEVEL_CLASSES[level] ?? 'badge-default',
  mb: (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(2)} MB`,
  isoDate: (ts: number): string => new Date(ts).toISOString().replace('T', ' ').slice(0, 19),
  timeOnly: (ts: number): string => new Date(ts).toISOString().slice(11, 23),
  toJson: (val: unknown): string => JSON.stringify(val, null, 2),
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
