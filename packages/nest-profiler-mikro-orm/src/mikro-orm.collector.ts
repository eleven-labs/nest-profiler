import { Injectable } from '@nestjs/common';
import { ProfilerCollector, AbstractSqlQueryCollector } from '@eleven-labs/nest-profiler';
import { MIKRO_ORM_QUERIES_KEY } from './mikro-orm-logger.patch.js';

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
}
