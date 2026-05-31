import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { ProfilerCollector } from '@eleven-labs/nest-profiler';
import type { IProfilerCollector, Profile } from '@eleven-labs/nest-profiler';
import { getCollectorEntries } from '@eleven-labs/nest-profiler';
import type { MongooseQueryEntry } from './mongoose-collector.interface';
import { MONGOOSE_QUERIES_KEY } from './mongoose-collector.interface';

const MONGO_ICON = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5c-.8 1-2 3-2 4.5a2 2 0 0 0 4 0c0-1.5-1.2-3.5-2-4.5z"/><path d="M8 9.5v5"/></svg>`;
const DB_ICON = `<svg viewBox="0 0 16 16" fill="currentColor"><ellipse cx="8" cy="4" rx="6" ry="2"/><path d="M2 4v3c0 1.1 2.7 2 6 2s6-.9 6-2V4"/><path d="M2 7v3c0 1.1 2.7 2 6 2s6-.9 6-2V7"/><path d="M2 10v2c0 1.1 2.7 2 6 2s6-.9 6-2v-2"/></svg>`;

@Injectable()
@ProfilerCollector({
  name: 'mongoose',
  label: 'MongoDB',
  icon: MONGO_ICON,
  priority: 15,
  group: 'database',
  groupLabel: 'Database',
  groupIcon: DB_ICON,
  groupPriority: 10,
})
export class MongooseCollector implements IProfilerCollector {
  readonly name = 'mongoose';
  readonly label = 'MongoDB';
  readonly icon = MONGO_ICON;
  readonly priority = 15;
  readonly group = 'database';
  readonly groupLabel = 'Database';
  readonly groupIcon = DB_ICON;
  readonly groupPriority = 10;

  getBadgeValue(profile: Profile): string | null {
    const queries =
      (profile.collectors[this.name] as MongooseQueryEntry[] | undefined) ??
      getCollectorEntries<MongooseQueryEntry>(profile, MONGOOSE_QUERIES_KEY);
    if (!queries.length) return null;
    const slowCount = queries.filter((q) => q.isSlow).length;
    const badge = `${queries.length}q`;
    return slowCount > 0 ? `${badge} (${slowCount} slow)` : badge;
  }

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'mongoose-panel.ejs');
  }

  collect(profile: Profile): MongooseQueryEntry[] {
    const queries = getCollectorEntries<MongooseQueryEntry>(profile, MONGOOSE_QUERIES_KEY);
    delete profile.collectors[MONGOOSE_QUERIES_KEY];
    return queries;
  }
}
