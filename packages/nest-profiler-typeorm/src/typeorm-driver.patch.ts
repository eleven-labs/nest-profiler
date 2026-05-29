import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import type { DataSource, QueryRunner } from 'typeorm';
import type { Profile } from '@eleven-labs/nest-profiler';
import { appendCollectorEntry } from '@eleven-labs/nest-profiler';
import type { QueryEntry } from './typeorm-collector.interface';
import { detectQueryType } from './typeorm-collector.interface';
import { TYPEORM_COLLECTOR_OPTIONS } from './typeorm-collector.module';
import type { TypeOrmCollectorModuleOptions } from './typeorm-collector.module';

export const TYPEORM_QUERIES_KEY = '__typeorm_queries';

type PatchableMethod = (...args: unknown[]) => Promise<unknown>;

/** TypeORM internal surface used for monkey-patching createQueryRunner. */
interface PatchableDataSource {
  createQueryRunner: (...args: unknown[]) => QueryRunner;
}

@Injectable()
export class TypeOrmDriverPatch implements OnModuleInit {
  constructor(
    private readonly cls: ClsService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional()
    @Inject(TYPEORM_COLLECTOR_OPTIONS)
    private readonly options: TypeOrmCollectorModuleOptions = {},
  ) {}

  onModuleInit(): void {
    if (!this.dataSource?.isInitialized) return;
    this.patchCreateQueryRunner(this.dataSource, this.options.slowQueryThreshold ?? 100);
  }

  private patchCreateQueryRunner(dataSource: DataSource, threshold: number): void {
    const cls = this.cls;
    const patchable = dataSource as DataSource & PatchableDataSource;
    const originalCreate = patchable.createQueryRunner.bind(dataSource);

    patchable.createQueryRunner = function (...args: unknown[]): QueryRunner {
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
            const profile = cls.get<Profile | undefined>('profiler.profile');
            if (profile) {
              const entry: QueryEntry = {
                sql: query,
                parameters: parameters ?? [],
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
  }
}
