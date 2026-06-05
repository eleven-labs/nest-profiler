import * as path from 'path';
import type { IProfilerCollector } from '../collector.interface';
import type { Profile } from '../../interfaces/profile.interface';
import { getCollectorEntries } from '../../utils/collector.utils';
import type { QueryEntry } from './sql-query.interface';

/**
 * Shared behaviour for SQL query collectors (TypeORM, MikroORM, …).
 *
 * Each ORM integration patches its own query surface and accumulates {@link QueryEntry}
 * items under a private `queriesKey`. This base provides the rendering-side contract
 * (badge, panel template, collect) so the per-ORM packages only carry their decorator
 * metadata, their `queriesKey`, and the ORM-specific patch.
 */
export abstract class AbstractSqlQueryCollector implements IProfilerCollector {
  /** Collector name — used as the panel id and the post-collect storage key. */
  abstract readonly name: string;
  /** Private profile.collectors key where the patch accumulates raw query entries. */
  protected abstract readonly queriesKey: string;

  getBadgeValue(profile: Profile): string | null {
    const queries =
      (profile.collectors[this.name] as QueryEntry[] | undefined) ??
      getCollectorEntries<QueryEntry>(profile, this.queriesKey);
    if (!queries.length) return null;
    const slowCount = queries.filter((q) => q.isSlow).length;
    const badge = `${queries.length}q`;
    return slowCount > 0 ? `${badge} (${slowCount} slow)` : badge;
  }

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'sql-panel.ejs');
  }

  collect(profile: Profile): QueryEntry[] {
    const queries = getCollectorEntries<QueryEntry>(profile, this.queriesKey);
    delete profile.collectors[this.queriesKey];
    return queries;
  }
}
