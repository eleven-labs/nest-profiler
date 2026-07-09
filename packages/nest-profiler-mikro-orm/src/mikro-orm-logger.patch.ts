import { Inject, Injectable, Optional, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { MikroORM } from '@mikro-orm/core';
import type { LogContext, Logger, LoggerNamespace } from '@mikro-orm/core';
import { getMikroORMToken } from '@mikro-orm/nestjs';
import { ClsService } from 'nestjs-cls';
import type { Profile } from '@eleven-labs/nest-profiler';
import { appendCollectorEntry, redact, tryResolve } from '@eleven-labs/nest-profiler';
import type {
  QueryEntry,
  MikroOrmCollectorModuleOptions,
} from './mikro-orm-collector.interface.js';
import { detectQueryType, MIKRO_ORM_COLLECTOR_OPTIONS } from './mikro-orm-collector.interface.js';

export const MIKRO_ORM_QUERIES_KEY = '__mikro_orm_queries';

/** Best-effort real error message from a MikroORM error-level log context, else a generic label. */
function extractLogError(context: LogContext): string {
  const withError = context as { error?: unknown };
  if (withError.error instanceof Error) return withError.error.message;
  if (typeof withError.error === 'string') return withError.error;
  return 'Query failed';
}

/**
 * Captures every SQL query executed by MikroORM by wrapping the ORM's `Logger.logQuery`
 */
@Injectable()
export class MikroOrmLoggerPatch implements OnModuleInit {
  private cls: ClsService | undefined;

  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(MIKRO_ORM_COLLECTOR_OPTIONS)
    private readonly options: MikroOrmCollectorModuleOptions = {},
  ) {}

  onModuleInit(): void {
    // Resolve lazily via ModuleRef (traverses to the core's global ClsModule and the named
    // MikroORM context token); no-op when the core is disabled or the ORM context is absent.
    this.cls = tryResolve<ClsService>(this.moduleRef, ClsService);
    const orm = tryResolve<MikroORM>(
      this.moduleRef,
      this.options.connectionName ? getMikroORMToken(this.options.connectionName) : MikroORM,
    );
    if (!this.cls || !orm) return;
    const logger = orm.config?.getLogger();
    if (!logger) return;
    this.patchLogger(logger);
  }

  private patchLogger(logger: Logger): void {
    const guarded = logger as Logger & { __profilerPatched?: boolean };
    if (guarded.__profilerPatched) return;

    const cls = this.cls;
    const originalLogQuery = logger.logQuery.bind(logger);
    const originalIsEnabled = logger.isEnabled.bind(logger);

    // We force `isEnabled('query')` to true so MikroORM always calls `logQuery` (our capture
    // hook) — this adds a small, permanent query-logging overhead for the whole process,
    // including seeders/crons. The host's real setting is re-read per call below to decide
    // whether to *also* forward to the original logger (so a runtime `setDebugMode` still
    // takes effect for console output).
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
          const profile = cls?.get<Profile | undefined>('profiler.profile');
          if (profile) {
            const duration = context.took ?? 0;
            const entry: QueryEntry = {
              sql,
              parameters: redact(context.params ? [...context.params] : []),
              duration,
              type: detectQueryType(sql),
              startedAt: Date.now() - duration,
              error: context.level === 'error' ? extractLogError(context) : undefined,
            };
            appendCollectorEntry<QueryEntry>(profile, MIKRO_ORM_QUERIES_KEY, entry);
          }
        } catch {
          // Outside CLS context — ignore
        }
      }
      // Forward to the original logger only when the host actually has query logging on —
      // re-evaluated per call so a runtime toggle (setDebugMode) is honoured.
      if (originalIsEnabled('query')) originalLogQuery(context);
    });

    guarded.__profilerPatched = true;
  }
}
