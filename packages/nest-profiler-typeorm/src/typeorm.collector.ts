import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { ProfilerCollector } from '@eleven-labs/nest-profiler';
import type { IProfilerCollector, Profile } from '@eleven-labs/nest-profiler';
import { getCollectorEntries } from '@eleven-labs/nest-profiler';
import type { QueryEntry } from './typeorm-collector.interface';
import { TYPEORM_QUERIES_KEY } from './typeorm-driver.patch';

const DB_ICON = `<svg viewBox="0 0 16 16" fill="currentColor"><ellipse cx="8" cy="4" rx="6" ry="2"/><path d="M2 4v3c0 1.1 2.7 2 6 2s6-.9 6-2V4"/><path d="M2 7v3c0 1.1 2.7 2 6 2s6-.9 6-2V7"/><path d="M2 10v2c0 1.1 2.7 2 6 2s6-.9 6-2v-2"/></svg>`;

@Injectable()
@ProfilerCollector({
  name: 'typeorm',
  label: 'SQL',
  icon: DB_ICON,
  priority: 10,
  group: 'database',
  groupLabel: 'Database',
  groupIcon: DB_ICON,
  groupPriority: 10,
})
export class TypeOrmCollector implements IProfilerCollector {
  readonly name = 'typeorm';
  readonly label = 'SQL';
  readonly icon = DB_ICON;
  readonly priority = 10;
  readonly group = 'database';
  readonly groupLabel = 'Database';
  readonly groupIcon = DB_ICON;
  readonly groupPriority = 10;

  getBadgeValue(profile: Profile): string | null {
    const queries =
      (profile.collectors[this.name] as QueryEntry[] | undefined) ??
      getCollectorEntries<QueryEntry>(profile, TYPEORM_QUERIES_KEY);
    if (!queries.length) return null;
    const slowCount = queries.filter((q) => q.isSlow).length;
    const badge = `${queries.length}q`;
    return slowCount > 0 ? `${badge} (${slowCount} slow)` : badge;
  }

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'typeorm-panel.ejs');
  }

  collect(profile: Profile): QueryEntry[] {
    const queries = getCollectorEntries<QueryEntry>(profile, TYPEORM_QUERIES_KEY);
    delete profile.collectors[TYPEORM_QUERIES_KEY];
    return queries;
  }
}
