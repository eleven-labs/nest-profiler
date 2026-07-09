import * as path from 'path';
import { AbstractQueryCollector } from '../abstract-query.collector';
import { normalizeSqlFingerprint } from '../../analysis/fingerprint.utils';
import type { QueryEntry } from './sql-query.interface';

/**
 * Shared behaviour for SQL query collectors (TypeORM, MikroORM, …).
 *
 * Each ORM integration patches its own query surface and accumulates {@link QueryEntry}
 * items under a private `queriesKey`. The rendering-side contract (badge, collect) is
 * factored by {@link AbstractQueryCollector}; this class pins the SQL panel template and
 * stamps a parameter-free {@link QueryEntry.fingerprint} on each drained entry (the N+1
 * grouping key), so the per-ORM packages carry just their decorator metadata and their
 * `queriesKey`.
 */
export abstract class AbstractSqlQueryCollector extends AbstractQueryCollector<QueryEntry> {
  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'sql-panel.ejs');
  }

  protected transform(queries: QueryEntry[]): QueryEntry[] {
    return queries.map((query) => ({
      ...query,
      fingerprint: normalizeSqlFingerprint(query.sql),
    }));
  }
}
