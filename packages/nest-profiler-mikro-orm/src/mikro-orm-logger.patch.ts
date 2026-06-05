import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import type { LogContext, Logger, LoggerNamespace } from '@mikro-orm/core';
import { ClsService } from 'nestjs-cls';
import type { Profile } from '@eleven-labs/nest-profiler';
import { appendCollectorEntry } from '@eleven-labs/nest-profiler';
import type {
  QueryEntry,
  MikroOrmCollectorModuleOptions,
} from './mikro-orm-collector.interface.js';
import { detectQueryType, MIKRO_ORM_COLLECTOR_OPTIONS } from './mikro-orm-collector.interface.js';

export const MIKRO_ORM_QUERIES_KEY = '__mikro_orm_queries';

/**
 * Captures every SQL query executed by MikroORM by wrapping the ORM's `Logger.logQuery`
 */
@Injectable()
export class MikroOrmLoggerPatch implements OnModuleInit {
  constructor(
    private readonly cls: ClsService,
    private readonly orm: MikroORM,
    @Optional()
    @Inject(MIKRO_ORM_COLLECTOR_OPTIONS)
    private readonly options: MikroOrmCollectorModuleOptions = {},
  ) {}

  onModuleInit(): void {
    const logger = this.orm?.config?.getLogger();
    if (!logger) return;
    this.patchLogger(logger, this.options.slowQueryThreshold ?? 100);
  }

  private patchLogger(logger: Logger, threshold: number): void {
    const cls = this.cls;
    const originalLogQuery = logger.logQuery.bind(logger);
    const originalIsEnabled = logger.isEnabled.bind(logger);
    const queryWasEnabled = originalIsEnabled('query');

    Reflect.set(
      logger,
      'isEnabled',
      function (namespace: LoggerNamespace, context?: LogContext): boolean {
        if (namespace === 'query') return true;
        return originalIsEnabled(namespace, context);
      },
    );

    Reflect.set(logger, 'logQuery', function (context: LogContext): void {
      const sql = context.query;
      if (sql) {
        try {
          const profile = cls.get<Profile | undefined>('profiler.profile');
          if (profile) {
            const duration = context.took ?? 0;
            const entry: QueryEntry = {
              sql,
              parameters: context.params ? [...context.params] : [],
              duration,
              type: detectQueryType(sql),
              isSlow: duration >= threshold,
              startedAt: Date.now() - duration,
              error: context.level === 'error' ? 'Query failed' : undefined,
            };
            appendCollectorEntry<QueryEntry>(profile, MIKRO_ORM_QUERIES_KEY, entry);
          }
        } catch {
          // Outside CLS context — ignore
        }
      }
      // Preserve the host application's original console logging behaviour.
      if (queryWasEnabled) originalLogQuery(context);
    });
  }
}
