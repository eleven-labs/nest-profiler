import { Inject, Injectable, Optional } from '@nestjs/common';
import { ProfilerCollector, AbstractSqlQueryCollector } from '@eleven-labs/nest-profiler';
import type { TagConfig } from '@eleven-labs/nest-profiler';
import { MIKRO_ORM_QUERIES_KEY } from './mikro-orm-logger.patch.js';
import { MIKRO_ORM_COLLECTOR_OPTIONS } from './mikro-orm-collector.interface.js';
import type { MikroOrmCollectorModuleOptions } from './mikro-orm-collector.interface.js';

const DB_ICON = `<svg viewBox="0 0 16 16" fill="currentColor"><ellipse cx="8" cy="4" rx="6" ry="2"/><path d="M2 4v3c0 1.1 2.7 2 6 2s6-.9 6-2V4"/><path d="M2 7v3c0 1.1 2.7 2 6 2s6-.9 6-2V7"/><path d="M2 10v2c0 1.1 2.7 2 6 2s6-.9 6-2v-2"/></svg>`;

@Injectable()
@ProfilerCollector({
  name: 'mikro-orm',
  label: 'MikroORM',
  icon: DB_ICON,
  priority: 10,
  group: 'database',
  groupLabel: 'Database',
  groupIcon: DB_ICON,
  groupPriority: 10,
})
export class MikroOrmCollector extends AbstractSqlQueryCollector {
  readonly name = 'mikro-orm';
  readonly label = 'MikroORM';
  readonly icon = DB_ICON;
  readonly priority = 10;
  readonly group = 'database';
  readonly groupLabel = 'Database';
  readonly groupIcon = DB_ICON;
  readonly groupPriority = 10;
  protected readonly queriesKey = MIKRO_ORM_QUERIES_KEY;

  constructor(
    @Optional()
    @Inject(MIKRO_ORM_COLLECTOR_OPTIONS)
    private readonly options: MikroOrmCollectorModuleOptions = {},
  ) {
    super();
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
