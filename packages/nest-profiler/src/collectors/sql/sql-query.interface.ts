import type { ProfilerTag } from '../../analysis/profiler-tag.interface';

export type QueryType = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'OTHER';

export interface QueryEntry {
  sql: string;
  parameters?: unknown[];
  duration: number;
  type: QueryType;
  startedAt: number;
  error?: string;
  /** True for streaming reads (e.g. `QueryRunner.stream()` / `QueryBuilder.stream()`). */
  streaming?: boolean;
  /**
   * Rows affected (writes) or returned (reads). Undefined when the driver does not
   * expose it or for streaming reads — a suspicious `0` on `UPDATE`/`DELETE` is
   * flagged by the `zero-rows` performance tag.
   */
  rowCount?: number;
  /** Connection endpoint, host:port only (no credentials). e.g. `"localhost:5432"`. */
  connection?: string;
  /** Target database / schema name (or file path for sqlite). */
  database?: string;
  /**
   * Parameter-free normalized SQL, used by the performance-rule engine to group
   * repeated executions (the N+1 signal). Filled by the SQL collector.
   */
  fingerprint?: string;
  /** Id of the GraphQL field span this query ran under, when resolved inside one. */
  parentSpanId?: string;
  /** Performance tags applied by the rule engine (slow, N+1, error…). */
  tags?: ProfilerTag[];
}

/** Where a statement sits in a transaction, or `null` for an ordinary query. */
export type TransactionBoundary = 'begin' | 'commit' | 'rollback';

const BEGIN_RE = /^(BEGIN|START\s+TRANSACTION)\b/;
const COMMIT_RE = /^(COMMIT|END\s+TRANSACTION)\b/;
const ROLLBACK_RE = /^ROLLBACK\b/;

/**
 * Classifies a statement as a transaction boundary. Savepoints (`SAVEPOINT`,
 * `ROLLBACK TO SAVEPOINT`) are deliberately not boundaries: they nest inside the
 * enclosing transaction rather than opening or closing one.
 */
export function detectTransactionBoundary(sql: string): TransactionBoundary | null {
  const upper = sql.trim().toUpperCase();
  if (upper.startsWith('ROLLBACK TO')) return null;
  if (BEGIN_RE.test(upper)) return 'begin';
  if (COMMIT_RE.test(upper)) return 'commit';
  if (ROLLBACK_RE.test(upper)) return 'rollback';
  return null;
}

export function detectQueryType(sql: string): QueryType {
  const upper = sql.trimStart().toUpperCase();
  if (upper.startsWith('SELECT')) return 'SELECT';
  if (upper.startsWith('INSERT')) return 'INSERT';
  if (upper.startsWith('UPDATE')) return 'UPDATE';
  if (upper.startsWith('DELETE')) return 'DELETE';
  return 'OTHER';
}
