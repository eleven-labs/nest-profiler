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
   * Parameter-free normalized SQL, used by the performance-rule engine to group
   * repeated executions (the N+1 signal). Filled by the SQL collector.
   */
  fingerprint?: string;
  /** Performance tags applied by the rule engine (slow, N+1, error…). */
  tags?: ProfilerTag[];
}

export function detectQueryType(sql: string): QueryType {
  const upper = sql.trimStart().toUpperCase();
  if (upper.startsWith('SELECT')) return 'SELECT';
  if (upper.startsWith('INSERT')) return 'INSERT';
  if (upper.startsWith('UPDATE')) return 'UPDATE';
  if (upper.startsWith('DELETE')) return 'DELETE';
  return 'OTHER';
}
