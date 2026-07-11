import { Inject, Injectable, Optional } from '@nestjs/common';
import * as path from 'path';
import { ProfilerCollector, AbstractQueryCollector } from '@eleven-labs/nest-profiler';
import type { TagConfig } from '@eleven-labs/nest-profiler';
import type {
  MongooseCollectorModuleOptions,
  MongooseQueryEntry,
} from './mongoose-collector.interface';
import { MONGOOSE_COLLECTOR_OPTIONS, MONGOOSE_QUERIES_KEY } from './mongoose-collector.interface';
import { buildMongoCommand, buildMongoFingerprint } from './build-mongo-command';

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
export class MongooseCollector extends AbstractQueryCollector<MongooseQueryEntry> {
  readonly name = 'mongoose';
  readonly label = 'MongoDB';
  readonly icon = MONGO_ICON;
  readonly priority = 15;
  readonly group = 'database';
  readonly groupLabel = 'Database';
  readonly groupIcon = DB_ICON;
  readonly groupPriority = 10;
  protected readonly queriesKey = MONGOOSE_QUERIES_KEY;

  constructor(
    @Optional()
    @Inject(MONGOOSE_COLLECTOR_OPTIONS)
    private readonly options: MongooseCollectorModuleOptions = {},
  ) {
    super();
  }

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'mongoose-panel.ejs');
  }

  protected transform(queries: MongooseQueryEntry[]): MongooseQueryEntry[] {
    return queries.map((query) => ({
      ...query,
      command: buildMongoCommand(query),
      fingerprint: buildMongoFingerprint(query),
    }));
  }

  /** Feeds the core performance-rule engine the thresholds configured on this module. */
  getTagConfig(): TagConfig {
    return {
      slowThreshold: this.options.slowThreshold ?? 100,
      nPlusOneThreshold: this.options.nPlusOneThreshold ?? 2,
      chattyThreshold: this.options.chattyThreshold ?? 20,
      slowSeverity: this.options.slowSeverity,
      nPlusOneSeverity: this.options.nPlusOneSeverity,
      chattySeverity: this.options.chattySeverity,
      zeroRowsSeverity: this.options.zeroRowsSeverity,
    };
  }
}
