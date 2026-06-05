export type QueryType = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'OTHER';

export interface QueryEntry {
  sql: string;
  parameters?: unknown[];
  duration: number;
  type: QueryType;
  isSlow: boolean;
  startedAt: number;
  error?: string;
}

export function detectQueryType(sql: string): QueryType {
  const upper = sql.trimStart().toUpperCase();
  if (upper.startsWith('SELECT')) return 'SELECT';
  if (upper.startsWith('INSERT')) return 'INSERT';
  if (upper.startsWith('UPDATE')) return 'UPDATE';
  if (upper.startsWith('DELETE')) return 'DELETE';
  return 'OTHER';
}
