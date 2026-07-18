import * as path from 'path';
import { AbstractQueryCollector } from '../abstract-query.collector';
import { normalizeSqlFingerprint } from '../../analysis/fingerprint.utils';
import { roundMs } from '../../utils/clock';
import type { Profile } from '../../interfaces/profile.interface';
import type { RawSpan } from '../../trace/build-trace';
import { detectTransactionBoundary } from './sql-query.interface';
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

  /** The full one-line, whitespace-collapsed SQL; the panel truncates it visually. */
  protected traceLabel(entry: QueryEntry): string {
    return entry.sql.replace(/\s+/g, ' ').trim();
  }

  /**
   * The per-query spans, with each `BEGIN … COMMIT/ROLLBACK` run wrapped in a synthetic
   * container span. Without it the boundary statements land as siblings of the work they
   * delimit — and, being sub-millisecond, in an order the waterfall cannot justify. The
   * wrapper spans the whole unit of work (start of `BEGIN` → end of its `COMMIT`), so its
   * duration is the transaction's real cost, and every statement in between nests under it.
   */
  getTraceSpans(profile: Profile): RawSpan[] {
    const spans = super.getTraceSpans(profile);
    const entries = this.getTaggableEntries(profile) ?? [];
    const result: RawSpan[] = [];
    // One open transaction per connection: two pools interleave their statements freely.
    const open = new Map<string, { id: string; span: RawSpan; entries: number }>();
    let counter = 0;

    for (const [index, span] of spans.entries()) {
      const entry = entries[index];
      const boundary = entry ? detectTransactionBoundary(entry.sql) : null;
      const key = entry?.connection ?? '';
      const current = open.get(key);

      if (boundary === 'begin' && !current) {
        const tx: RawSpan = {
          kind: 'db',
          label: 'transaction',
          startedAt: span.startedAt,
          duration: span.duration,
          container: true,
          id: `${this.name}-tx-${counter++}`,
          parentId: span.parentId,
          meta: { statements: 0 },
        };
        open.set(key, { id: tx.id!, span: tx, entries: 0 });
        result.push(tx, { ...span, parentId: tx.id });
        continue;
      }

      if (!current) {
        result.push(span);
        continue;
      }

      if (!boundary) current.entries += 1;
      current.span.duration = roundMs(
        Math.max(span.startedAt + span.duration - current.span.startedAt, current.span.duration),
      );
      current.span.meta = { ...current.span.meta, statements: current.entries };
      if (span.status === 'error') current.span.status = 'error';
      result.push({ ...span, parentId: current.id });

      if (boundary === 'commit' || boundary === 'rollback') {
        current.span.label = boundary === 'rollback' ? 'transaction (rolled back)' : 'transaction';
        open.delete(key);
      }
    }

    return result;
  }

  protected traceMeta(entry: QueryEntry): Record<string, string | number | boolean> | undefined {
    const meta: Record<string, string | number | boolean> = { type: entry.type };
    if (entry.rowCount !== undefined) meta.rowCount = entry.rowCount;
    if (entry.connection) meta.connection = entry.connection;
    return meta;
  }
}
