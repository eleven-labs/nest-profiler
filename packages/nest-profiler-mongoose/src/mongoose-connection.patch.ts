import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import type { Connection } from 'mongoose';
import type { Profile } from '@eleven-labs/nest-profiler';
import { appendCollectorEntry } from '@eleven-labs/nest-profiler';
import type { MongooseQueryEntry } from './mongoose-collector.interface';
import { MONGOOSE_QUERIES_KEY } from './mongoose-collector.interface';
import { MONGOOSE_COLLECTOR_OPTIONS } from './mongoose-collector.module';
import type { MongooseCollectorModuleOptions } from './mongoose-collector.module';

/** Narrow surface of mongoose.Query used during patching. */
interface PatchableQuery {
  op?: string;
  model?: { collection?: { name?: string } };
  getFilter(): Record<string, unknown>;
}

/** Narrow surface of mongoose.Aggregate used during patching. */
interface PatchableAggregate {
  _model?: { collection?: { name?: string } };
  _pipeline?: unknown[];
}

interface PatchableExec {
  (...args: unknown[]): Promise<unknown>;
  __profilerPatched?: boolean;
}

/** Mongoose base instance accessible via connection.base */
interface MongooseBase {
  Query: { prototype: PatchableQuery & { exec: PatchableExec } };
  Aggregate: { prototype: PatchableAggregate & { exec: PatchableExec } };
}

type PatchableConnection = Connection & { base: MongooseBase };

@Injectable()
export class MongooseConnectionPatch implements OnModuleInit {
  constructor(
    private readonly cls: ClsService,
    @InjectConnection() private readonly connection: Connection,
    @Optional()
    @Inject(MONGOOSE_COLLECTOR_OPTIONS)
    private readonly options: MongooseCollectorModuleOptions = {},
  ) {}

  onModuleInit(): void {
    const threshold = this.options.slowQueryThreshold ?? 100;
    const conn = this.connection as PatchableConnection;
    const mongoose = conn.base;
    if (mongoose?.Query?.prototype == null || mongoose?.Aggregate?.prototype == null) return;
    this.patchQueryExec(mongoose, threshold);
    this.patchAggregateExec(mongoose, threshold);
  }

  private patchQueryExec(mongoose: MongooseBase, threshold: number): void {
    if (mongoose.Query.prototype.exec.__profilerPatched) return;
    const cls = this.cls;
    const originalExec = mongoose.Query.prototype.exec;

    const patched: PatchableExec = async function (
      this: PatchableQuery & { exec: PatchableExec },
      ...args: unknown[]
    ): Promise<unknown> {
      const startedAt = Date.now();
      const collection = this.model?.collection?.name ?? 'unknown';
      const operation = this.op ?? 'unknown';
      let filter: Record<string, unknown> | undefined;
      try {
        filter = this.getFilter();
      } catch {
        // not all query types support getFilter()
      }
      let resultArray: unknown[] | undefined;
      let error: string | undefined;
      try {
        const result = await originalExec.apply(this, args as []);
        if (Array.isArray(result)) resultArray = result;
        return result;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        const duration = Date.now() - startedAt;
        try {
          const profile = cls.get<Profile | undefined>('profiler.profile');
          if (profile) {
            const entry: MongooseQueryEntry = {
              collection,
              operation,
              filter,
              duration,
              isSlow: duration >= threshold,
              startedAt,
              count: resultArray?.length,
              error,
            };
            appendCollectorEntry<MongooseQueryEntry>(profile, MONGOOSE_QUERIES_KEY, entry);
          }
        } catch {
          // Outside CLS context — ignore
        }
      }
    };

    patched.__profilerPatched = true;
    mongoose.Query.prototype.exec = patched;
  }

  private patchAggregateExec(mongoose: MongooseBase, threshold: number): void {
    if (mongoose.Aggregate.prototype.exec.__profilerPatched) return;
    const cls = this.cls;
    const originalExec = mongoose.Aggregate.prototype.exec;

    const patched: PatchableExec = async function (
      this: PatchableAggregate & { exec: PatchableExec },
      ...args: unknown[]
    ): Promise<unknown> {
      const startedAt = Date.now();
      const collection = this._model?.collection?.name ?? 'unknown';
      const pipeline = Array.isArray(this._pipeline) ? [...this._pipeline] : undefined;
      let resultArray: unknown[] | undefined;
      let error: string | undefined;
      try {
        const result = await originalExec.apply(this, args as []);
        if (Array.isArray(result)) resultArray = result;
        return result;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        const duration = Date.now() - startedAt;
        try {
          const profile = cls.get<Profile | undefined>('profiler.profile');
          if (profile) {
            const entry: MongooseQueryEntry = {
              collection,
              operation: 'aggregate',
              pipeline,
              duration,
              isSlow: duration >= threshold,
              startedAt,
              count: resultArray?.length,
              error,
            };
            appendCollectorEntry<MongooseQueryEntry>(profile, MONGOOSE_QUERIES_KEY, entry);
          }
        } catch {
          // Outside CLS context — ignore
        }
      }
    };

    patched.__profilerPatched = true;
    mongoose.Aggregate.prototype.exec = patched;
  }
}
