import { Inject, Injectable, Optional, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import type { Connection } from 'mongoose';
import type { Profile } from '@eleven-labs/nest-profiler';
import { appendCollectorEntry, redact, tryResolve } from '@eleven-labs/nest-profiler';
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

/** Narrow surface of the base Model used to patch write operations. */
interface PatchableModel {
  prototype: { save?: PatchableExec };
  insertMany?: PatchableExec;
  bulkWrite?: PatchableExec;
}

/** Mongoose base instance accessible via connection.base */
interface MongooseBase {
  Query: { prototype: PatchableQuery & { exec: PatchableExec } };
  Aggregate: { prototype: PatchableAggregate & { exec: PatchableExec } };
  Model?: PatchableModel;
}

/** Reads a `collection.name` off a document (`this.constructor`) or a model (`this`). */
function collectionNameOf(source: unknown): string {
  const holder = source as {
    collection?: { name?: string };
    constructor?: { collection?: { name?: string } };
  };
  return holder?.collection?.name ?? holder?.constructor?.collection?.name ?? 'unknown';
}

type PatchableConnection = Connection & { base: MongooseBase };

@Injectable()
export class MongooseConnectionPatch implements OnModuleInit {
  private cls: ClsService | undefined;

  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(MONGOOSE_COLLECTOR_OPTIONS)
    private readonly options: MongooseCollectorModuleOptions = {},
  ) {}

  onModuleInit(): void {
    // Resolve lazily via ModuleRef (traverses to the core's global ClsModule and the named
    // connection token); no-op when the core is disabled or the connection is absent.
    this.cls = tryResolve<ClsService>(this.moduleRef, ClsService);
    const connection = tryResolve<Connection>(
      this.moduleRef,
      getConnectionToken(this.options.connectionName),
    );
    if (!this.cls || !connection) return;
    const threshold = this.options.slowQueryThreshold ?? 100;
    const conn = connection as PatchableConnection;
    const mongoose = conn.base;
    if (mongoose?.Query?.prototype == null || mongoose?.Aggregate?.prototype == null) return;
    this.patchQueryExec(mongoose, threshold);
    this.patchAggregateExec(mongoose, threshold);
    this.patchWrites(mongoose, threshold);
  }

  /**
   * Patches document/model write operations that bypass `Query.exec` — `document.save()` (and
   * therefore `Model.create()`), `Model.insertMany()` and `Model.bulkWrite()` — so writes are
   * no longer invisible in the MongoDB panel. Each is guarded/idempotent and no-ops when the
   * underlying mongoose build does not expose it.
   */
  private patchWrites(mongoose: MongooseBase, threshold: number): void {
    const model = mongoose.Model;
    if (!model) return;
    const cls = this.cls;

    const record = (
      operation: string,
      collection: string,
      startedAt: number,
      count: number | undefined,
      error: string | undefined,
    ): void => {
      try {
        const profile = cls?.get<Profile | undefined>('profiler.profile');
        if (!profile) return;
        const duration = Date.now() - startedAt;
        appendCollectorEntry<MongooseQueryEntry>(profile, MONGOOSE_QUERIES_KEY, {
          collection,
          operation,
          duration,
          isSlow: duration >= threshold,
          startedAt,
          count,
          error,
        });
      } catch {
        // Outside CLS context — ignore
      }
    };

    const wrap = (operation: string, countOf: (args: unknown[]) => number | undefined) =>
      async function (this: unknown, original: PatchableExec, args: unknown[]): Promise<unknown> {
        const startedAt = Date.now();
        const collection = collectionNameOf(this);
        let error: string | undefined;
        try {
          return await original.apply(this, args);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          throw err;
        } finally {
          record(operation, collection, startedAt, countOf(args), error);
        }
      };

    // document.save() — also covers Model.create() for single documents.
    const save = model.prototype.save;
    if (typeof save === 'function' && !save.__profilerPatched) {
      const runner = wrap('save', () => 1);
      const patched: PatchableExec = function (
        this: unknown,
        ...args: unknown[]
      ): Promise<unknown> {
        return runner.call(this, save, args);
      };
      patched.__profilerPatched = true;
      model.prototype.save = patched;
    }

    // Static Model.insertMany / Model.bulkWrite.
    const insertMany = model.insertMany;
    if (typeof insertMany === 'function' && !insertMany.__profilerPatched) {
      const runner = wrap('insertMany', (args) =>
        Array.isArray(args[0]) ? args[0].length : undefined,
      );
      const patched: PatchableExec = function (
        this: unknown,
        ...args: unknown[]
      ): Promise<unknown> {
        return runner.call(this, insertMany, args);
      };
      patched.__profilerPatched = true;
      model.insertMany = patched;
    }

    const bulkWrite = model.bulkWrite;
    if (typeof bulkWrite === 'function' && !bulkWrite.__profilerPatched) {
      const runner = wrap('bulkWrite', (args) =>
        Array.isArray(args[0]) ? args[0].length : undefined,
      );
      const patched: PatchableExec = function (
        this: unknown,
        ...args: unknown[]
      ): Promise<unknown> {
        return runner.call(this, bulkWrite, args);
      };
      patched.__profilerPatched = true;
      model.bulkWrite = patched;
    }
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
          const profile = cls?.get<Profile | undefined>('profiler.profile');
          if (profile) {
            const entry: MongooseQueryEntry = {
              collection,
              operation,
              // Redact sensitive keys/values in the query filter (e.g. a lookup on a hashed
              // password or a token field) before persisting/displaying it.
              filter: filter ? redact(filter) : undefined,
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
          const profile = cls?.get<Profile | undefined>('profiler.profile');
          if (profile) {
            const entry: MongooseQueryEntry = {
              collection,
              operation: 'aggregate',
              pipeline: pipeline ? redact(pipeline) : undefined,
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
