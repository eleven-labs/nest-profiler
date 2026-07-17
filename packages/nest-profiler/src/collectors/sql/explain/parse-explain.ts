import type { ExplainPlan, ExplainRawResult } from './explain.interface';

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** A postgres plan node from `EXPLAIN (FORMAT JSON)`; only the fields we read are typed. */
interface PgNode {
  'Node Type'?: string;
  'Relation Name'?: string;
  'Plan Rows'?: number;
  'Total Cost'?: number;
  Plans?: PgNode[];
}

function walkPg(node: PgNode, visit: (node: PgNode) => void): void {
  visit(node);
  for (const child of node.Plans ?? []) walkPg(child, visit);
}

function parsePostgres(raw: unknown): Partial<ExplainPlan> {
  const root: PgNode | undefined = Array.isArray(raw)
    ? (raw[0] as { Plan?: PgNode })?.Plan
    : ((raw as { Plan?: PgNode })?.Plan ?? (raw as PgNode));
  if (!root || typeof root !== 'object') return {};

  const seqScanRelations: string[] = [];
  walkPg(root, (node) => {
    if (node['Node Type'] === 'Seq Scan' && node['Relation Name']) {
      seqScanRelations.push(node['Relation Name']);
    }
  });

  return {
    planType: root['Node Type'] ?? null,
    hasSeqScan: seqScanRelations.length > 0,
    seqScanRelations,
    estimatedRows: toNumber(root['Plan Rows']),
    estimatedCost: toNumber(root['Total Cost']),
  };
}

/** Recursively collects every object carrying an `access_type` from a MySQL JSON plan. */
function collectMysqlTables(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectMysqlTables(item, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (typeof record['access_type'] === 'string') out.push(record);
  for (const nested of Object.values(record)) collectMysqlTables(nested, out);
}

function parseMysql(raw: unknown): Partial<ExplainPlan> {
  const queryBlock = (raw as { query_block?: Record<string, unknown> })?.query_block ?? raw;
  const tables: Record<string, unknown>[] = [];
  collectMysqlTables(queryBlock, tables);

  const seqScanRelations = tables
    .filter((t) => t['access_type'] === 'ALL')
    .map((t) => (typeof t['table_name'] === 'string' ? t['table_name'] : ''))
    .filter(Boolean);

  const top = tables[0];
  const cost = (queryBlock as { cost_info?: { query_cost?: unknown } })?.cost_info?.query_cost;

  return {
    planType: top ? `access_type: ${String(top['access_type'])}` : null,
    hasSeqScan: seqScanRelations.length > 0,
    seqScanRelations,
    estimatedRows: toNumber(top?.['rows_examined_per_scan']),
    estimatedCost: toNumber(typeof cost === 'string' ? Number(cost) : cost),
  };
}

/** A SQLite `EXPLAIN QUERY PLAN` row. */
interface SqliteRow {
  detail?: string;
}

function parseSqlite(raw: unknown): Partial<ExplainPlan> {
  const rows: SqliteRow[] = Array.isArray(raw) ? (raw as SqliteRow[]) : [];
  const seqScanRelations: string[] = [];
  for (const row of rows) {
    const detail = row.detail ?? '';
    // "SCAN <table>" is a full scan; "SEARCH <table> USING INDEX ..." uses an index.
    const match = /^SCAN\s+(?:TABLE\s+)?(\w+)/i.exec(detail);
    if (match?.[1]) seqScanRelations.push(match[1]);
  }
  return {
    planType: rows[0]?.detail ?? null,
    hasSeqScan: seqScanRelations.length > 0,
    seqScanRelations,
  };
}

/**
 * Normalizes a dialect-specific raw EXPLAIN output into a {@link ExplainPlan}: it extracts
 * the top-level plan type, flags full-table (sequential) scans and the relations they hit,
 * and pulls estimated rows/cost when the dialect exposes them. Never throws — on malformed
 * input it returns a minimal plan carrying just the raw output.
 */
export function parseExplainPlan(result: ExplainRawResult): ExplainPlan {
  const { dialect, analyzed, raw } = result;
  const base: ExplainPlan = {
    dialect,
    analyzed,
    planType: null,
    hasSeqScan: false,
    seqScanRelations: [],
    raw,
  };
  try {
    switch (dialect) {
      case 'postgres':
        return { ...base, ...parsePostgres(raw) };
      case 'mysql':
        return { ...base, ...parseMysql(raw) };
      case 'sqlite':
        return { ...base, ...parseSqlite(raw) };
      default:
        return base;
    }
  } catch {
    return base;
  }
}
