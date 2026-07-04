import { Inject, Injectable, Logger, Optional, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import type { DataSource, QueryRunner } from 'typeorm';
import type { Profile } from '@eleven-labs/nest-profiler';
import { appendCollectorEntry, redact, tryResolve } from '@eleven-labs/nest-profiler';
import type { QueryEntry } from './typeorm-collector.interface';
import { detectQueryType } from './typeorm-collector.interface';
import { TYPEORM_COLLECTOR_OPTIONS } from './typeorm-collector.module';
import type { TypeOrmCollectorModuleOptions } from './typeorm-collector.module';

export const TYPEORM_QUERIES_KEY = '__typeorm_queries';

type PatchableMethod = (...args: unknown[]) => Promise<unknown>;

/** A patched `createQueryRunner` tagged so re-initialisation cannot re-wrap it. */
type PatchedCreateQueryRunner = ((...args: unknown[]) => QueryRunner) & {
  __profilerPatched?: boolean;
};

/** TypeORM internal surface used for monkey-patching createQueryRunner. */
interface PatchableDataSource {
  createQueryRunner: PatchedCreateQueryRunner;
}

/**
 * `cls` and the (optionally named) DataSource are resolved lazily via ModuleRef in
 * `onModuleInit` (a plain `@Optional()` constructor dependency does not traverse to the core's
 * global ClsModule from a dynamic feature module, and the DataSource may be a named connection).
 * When the profiler core is disabled or the configured connection is absent, the patch no-ops.
 */
@Injectable()
export class TypeOrmDriverPatch implements OnModuleInit {
  private readonly logger = new Logger(TypeOrmDriverPatch.name);
  private cls: ClsService | undefined;

  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(TYPEORM_COLLECTOR_OPTIONS)
    private readonly options: TypeOrmCollectorModuleOptions = {},
  ) {}

  onModuleInit(): void {
    this.cls = tryResolve<ClsService>(this.moduleRef, ClsService);
    if (!this.cls) return;

    const dataSource = tryResolve<DataSource>(
      this.moduleRef,
      getDataSourceToken(this.options.connectionName),
    );
    if (!dataSource) {
      if (this.options.connectionName) {
        this.logger.warn(
          `TypeORM DataSource "${this.options.connectionName}" not found — queries will not be profiled.`,
        );
      }
      return;
    }
    // With manualInitialization the DataSource may not be initialized yet at onModuleInit;
    // warn rather than silently do nothing (MIN-20).
    if (!dataSource.isInitialized) {
      this.logger.warn(
        'TypeORM DataSource is not initialized at bootstrap — queries will not be profiled.',
      );
      return;
    }
    this.patchCreateQueryRunner(dataSource, this.options.slowQueryThreshold ?? 100);
  }

  private patchCreateQueryRunner(dataSource: DataSource, threshold: number): void {
    const cls = this.cls;
    const patchable = dataSource as DataSource & PatchableDataSource;
    if (patchable.createQueryRunner.__profilerPatched) return;
    const originalCreate = patchable.createQueryRunner.bind(dataSource);

    const patched: PatchedCreateQueryRunner = function (...args: unknown[]): QueryRunner {
      const qr = originalCreate(...args);
      // TypeORM's query() has complex overloads — bind as PatchableMethod (widening cast),
      // then use Reflect.set to assign the patched version without a type conflict on assignment.
      const originalQuery = qr.query.bind(qr) as PatchableMethod;

      const patchedQuery: PatchableMethod = async function (...args: unknown[]): Promise<unknown> {
        const query = String(args[0]);
        const parameters = Array.isArray(args[1]) ? args[1] : undefined;
        const rest = args.slice(2);
        const startedAt = Date.now();
        let error: string | undefined;
        try {
          return await originalQuery(query, parameters, ...rest);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          throw err;
        } finally {
          const duration = Date.now() - startedAt;
          try {
            const profile = cls?.get<Profile | undefined>('profiler.profile');
            if (profile) {
              const entry: QueryEntry = {
                sql: query,
                // Redact credentials embedded in bound parameters (DSNs, JWTs, keys) before
                // they are persisted/displayed. Non-sensitive values pass through unchanged.
                parameters: redact(parameters ?? []),
                duration,
                type: detectQueryType(query),
                isSlow: duration >= threshold,
                startedAt,
                error,
              };
              appendCollectorEntry<QueryEntry>(profile, TYPEORM_QUERIES_KEY, entry);
            }
          } catch {
            // Outside CLS context — ignore
          }
        }
      };

      Reflect.set(qr, 'query', patchedQuery);
      return qr;
    };

    patched.__profilerPatched = true;
    patchable.createQueryRunner = patched;
  }
}
