import { Inject, Injectable, Optional, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import type { Connection } from 'mongoose';
import type { Profile, SafeDataOptions } from '@eleven-labs/nest-profiler';
import { appendCollectorEntry, redact, toSafeData, tryResolve } from '@eleven-labs/nest-profiler';
// Import the options token from the interface module, never from `./mongoose-collector.module`:
// that module imports this file, and the resulting cycle leaves the re-exported token
// undefined when the decorators below run — `@Inject(undefined)` then silently degrades to the
// `@Optional()` default, so every option (captureResult, connectionName…) would be ignored.
import type {
  MongooseCollectorModuleOptions,
  MongooseQueryEntry,
} from './mongoose-collector.interface';
import { MONGOOSE_COLLECTOR_OPTIONS, MONGOOSE_QUERIES_KEY } from './mongoose-collector.interface';

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

/** A patched `cursor()` returning a QueryCursor/AggregationCursor synchronously. */
interface PatchableCursor {
  (...args: unknown[]): unknown;
  __profilerPatched?: boolean;
}

/** Minimal QueryCursor surface used to time a cursor without consuming its data. */
interface LifecycleCursor {
  once(event: string, listener: (...args: unknown[]) => void): unknown;
}

/** Narrow surface of the base Model used to patch write operations. */
interface PatchableModel {
  prototype: { save?: PatchableExec };
  insertMany?: PatchableExec;
  bulkWrite?: PatchableExec;
}

/** Mongoose base instance accessible via connection.base */
interface MongooseBase {
  Query: { prototype: PatchableQuery & { exec: PatchableExec; cursor?: PatchableCursor } };
  Aggregate: { prototype: PatchableAggregate & { exec: PatchableExec; cursor?: PatchableCursor } };
  Model?: PatchableModel;
}

/** Connection metadata derived once from the mongoose Connection, shared by every captured entry. */
interface ConnectionMeta {
  connection?: string;
  database?: string;
}

/** Reads host:port / database name off the mongoose Connection, omitting anything absent. */
function readConnectionMeta(connection: Connection): ConnectionMeta {
  const conn = connection as {
    host?: unknown;
    port?: unknown;
    name?: unknown;
    db?: { databaseName?: unknown };
  };
  const host = typeof conn.host === 'string' ? conn.host : undefined;
  const port =
    typeof conn.port === 'number' || typeof conn.port === 'string' ? conn.port : undefined;
  const database =
    typeof conn.name === 'string'
      ? conn.name
      : typeof conn.db?.databaseName === 'string'
        ? conn.db.databaseName
        : undefined;
  return {
    connection: host && port != null ? `${host}:${port}` : undefined,
    database,
  };
}

/** Reads a `collection.name` off a document (`this.constructor`) or a model (`this`). */
function collectionNameOf(source: unknown): string {
  const holder = source as {
    collection?: { name?: string };
    constructor?: { collection?: { name?: string } };
  };
  return holder?.collection?.name ?? holder?.constructor?.collection?.name ?? 'unknown';
}

/** Write acknowledgement as returned by `update*` / `delete*` / `replace*` operations. */
interface WriteAcknowledgement {
  deletedCount?: unknown;
  modifiedCount?: unknown;
  upsertedCount?: unknown;
  matchedCount?: unknown;
}

/** Operations whose result is a write acknowledgement rather than documents. */
const WRITE_OPERATIONS = /^(update|delete|replace)/i;

/** Operations resolving to a single document, or `null` when nothing matched. */
const SINGLE_DOCUMENT_OPERATIONS = /^(findOne|findById)/i;

/** Documents affected by a write, read off its acknowledgement. */
function acknowledgedCount(result: unknown): number | undefined {
  if (result === null || typeof result !== 'object') return undefined;
  const ack = result as WriteAcknowledgement;
  if (typeof ack.deletedCount === 'number') return ack.deletedCount;
  if (typeof ack.modifiedCount === 'number') {
    // An upsert modifies nothing yet still writes a document — it counts as affected,
    // otherwise the zero-rows rule would flag a successful upsert as a silent failure.
    return ack.modifiedCount + (typeof ack.upsertedCount === 'number' ? ack.upsertedCount : 0);
  }
  if (typeof ack.matchedCount === 'number') return ack.matchedCount;
  return undefined;
}

/**
 * Derives the documents-affected count from whatever the operation resolved to. Arrays report
 * their length (`find`, `distinct`, `aggregate`), counting operations report the number itself
 * (`countDocuments`, `estimatedDocumentCount`), writes report their acknowledgement, and
 * single-document reads collapse to `1` / `0`. Anything unrecognized stays `undefined` so the
 * panel omits the figure rather than displaying a wrong one.
 */
export function resultCount(operation: string, result: unknown): number | undefined {
  if (Array.isArray(result)) return result.length;
  if (typeof result === 'number') return Number.isFinite(result) ? result : undefined;
  if (WRITE_OPERATIONS.test(operation)) return acknowledgedCount(result);
  if (SINGLE_DOCUMENT_OPERATIONS.test(operation)) return result == null ? 0 : 1;
  return undefined;
}

/**
 * Projects an operation result into something safe to persist and display: hydrated documents
 * are flattened through `toSafeData` (which honors their `toJSON`, caps depth/size and keeps the
 * payload JSON-serializable), then run through the shared redaction so a document field holding
 * a token or a password never lands in a profile.
 */
export function safeResult(result: unknown, limits: SafeDataOptions | undefined): unknown {
  return redact(toSafeData(result, limits ?? {}));
}

type PatchableConnection = Connection & { base: MongooseBase };

@Injectable()
export class MongooseConnectionPatch implements OnModuleInit {
  private cls: ClsService | undefined;
  private connMeta: ConnectionMeta = {};

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
    this.connMeta = readConnectionMeta(connection);
    const conn = connection as PatchableConnection;
    const mongoose = conn.base;
    if (mongoose?.Query?.prototype == null || mongoose?.Aggregate?.prototype == null) return;
    this.patchQueryExec(mongoose);
    this.patchAggregateExec(mongoose);
    this.patchQueryCursor(mongoose);
    this.patchAggregateCursor(mongoose);
    this.patchWrites(mongoose);
  }

  /**
   * Patches document/model write operations that bypass `Query.exec` — `document.save()` (and
   * therefore `Model.create()`), `Model.insertMany()` and `Model.bulkWrite()` — so writes are
   * no longer invisible in the MongoDB panel. Each is guarded/idempotent and no-ops when the
   * underlying mongoose build does not expose it.
   */
  private patchWrites(mongoose: MongooseBase): void {
    const model = mongoose.Model;
    if (!model) return;
    const cls = this.cls;
    const meta = this.connMeta;
    const capture = this.options.captureResult === true;
    const limits = this.options.resultLimits;

    const record = (
      operation: string,
      collection: string,
      startedAt: number,
      count: number | undefined,
      captured: unknown,
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
          startedAt,
          count,
          result: captured,
          connection: meta.connection,
          database: meta.database,
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
        let captured: unknown;
        let error: string | undefined;
        try {
          const result = await original.apply(this, args);
          if (capture && result !== undefined) captured = safeResult(result, limits);
          return result;
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          throw err;
        } finally {
          record(operation, collection, startedAt, countOf(args), captured, error);
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

  private patchQueryExec(mongoose: MongooseBase): void {
    if (mongoose.Query.prototype.exec.__profilerPatched) return;
    const cls = this.cls;
    const meta = this.connMeta;
    const capture = this.options.captureResult === true;
    const limits = this.options.resultLimits;
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
      let count: number | undefined;
      let captured: unknown;
      let error: string | undefined;
      try {
        const result = await originalExec.apply(this, args as []);
        count = resultCount(operation, result);
        if (capture && result !== undefined) captured = safeResult(result, limits);
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
              startedAt,
              count,
              result: captured,
              error,
              connection: meta.connection,
              database: meta.database,
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

  private patchAggregateExec(mongoose: MongooseBase): void {
    if (mongoose.Aggregate.prototype.exec.__profilerPatched) return;
    const cls = this.cls;
    const meta = this.connMeta;
    const capture = this.options.captureResult === true;
    const limits = this.options.resultLimits;
    const originalExec = mongoose.Aggregate.prototype.exec;

    const patched: PatchableExec = async function (
      this: PatchableAggregate & { exec: PatchableExec },
      ...args: unknown[]
    ): Promise<unknown> {
      const startedAt = Date.now();
      const collection = this._model?.collection?.name ?? 'unknown';
      const pipeline = Array.isArray(this._pipeline) ? [...this._pipeline] : undefined;
      let count: number | undefined;
      let captured: unknown;
      let error: string | undefined;
      try {
        const result = await originalExec.apply(this, args as []);
        count = resultCount('aggregate', result);
        if (capture && result !== undefined) captured = safeResult(result, limits);
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
              startedAt,
              count,
              result: captured,
              error,
              connection: meta.connection,
              database: meta.database,
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

  /**
   * Patches `Query.prototype.cursor()` — streaming reads that bypass `Query.exec` entirely.
   * The cursor is a long-lived stream, so duration is measured across its lifetime via the
   * terminal `close`/`error` events only; no `data` listener is attached (that would force
   * flowing mode and steal documents from the caller), so streamed row `count` is not captured.
   */
  private patchQueryCursor(mongoose: MongooseBase): void {
    const cursorFn = mongoose.Query.prototype.cursor;
    if (typeof cursorFn !== 'function' || cursorFn.__profilerPatched) return;
    const cls = this.cls;
    const meta = this.connMeta;
    const originalCursor = cursorFn;

    const patched: PatchableCursor = function (this: PatchableQuery, ...args: unknown[]): unknown {
      const startedAt = Date.now();
      const collection = this.model?.collection?.name ?? 'unknown';
      const operation = this.op ?? 'find';
      let filter: Record<string, unknown> | undefined;
      try {
        filter = this.getFilter();
      } catch {
        // not all query types support getFilter()
      }
      const profile = cls?.get<Profile | undefined>('profiler.profile');
      const cursor = originalCursor.apply(this, args);
      recordCursorLifecycle(profile, cursor, startedAt, {
        collection,
        operation,
        filter: filter ? redact(filter) : undefined,
        connection: meta.connection,
        database: meta.database,
      });
      return cursor;
    };

    patched.__profilerPatched = true;
    mongoose.Query.prototype.cursor = patched;
  }

  /**
   * Patches `Aggregate.prototype.cursor()` — the aggregation streaming counterpart of
   * {@link patchQueryCursor}. Same non-intrusive timing (terminal events only, no `count`).
   */
  private patchAggregateCursor(mongoose: MongooseBase): void {
    const cursorFn = mongoose.Aggregate.prototype.cursor;
    if (typeof cursorFn !== 'function' || cursorFn.__profilerPatched) return;
    const cls = this.cls;
    const meta = this.connMeta;
    const originalCursor = cursorFn;

    const patched: PatchableCursor = function (
      this: PatchableAggregate,
      ...args: unknown[]
    ): unknown {
      const startedAt = Date.now();
      const collection = this._model?.collection?.name ?? 'unknown';
      const pipeline = Array.isArray(this._pipeline) ? [...this._pipeline] : undefined;
      const profile = cls?.get<Profile | undefined>('profiler.profile');
      const cursor = originalCursor.apply(this, args);
      recordCursorLifecycle(profile, cursor, startedAt, {
        collection,
        operation: 'aggregate',
        pipeline: pipeline ? redact(pipeline) : undefined,
        connection: meta.connection,
        database: meta.database,
      });
      return cursor;
    };

    patched.__profilerPatched = true;
    mongoose.Aggregate.prototype.cursor = patched;
  }
}

/**
 * Records a streaming read for a cursor. The entry is appended immediately, at cursor creation
 * (synchronously, inside the request's CLS context and before the profiler collects), so the read
 * is captured whatever the consumption pattern. Its `duration` is then finalized in place if a
 * terminal `close`/`end`/`error` event fires — which happens for flowing / `pipe()` / explicit
 * `close()` consumption but NOT for `for await` / `eachAsync()` on a Mongoose cursor (they emit no
 * terminal event); those keep `duration = 0`, a documented limitation, since measuring it would
 * require wrapping the row iterator (a per-document cost).
 */
function recordCursorLifecycle(
  profile: Profile | undefined,
  cursor: unknown,
  startedAt: number,
  meta: Pick<
    MongooseQueryEntry,
    'collection' | 'operation' | 'filter' | 'pipeline' | 'connection' | 'database'
  >,
): void {
  if (!profile) return;
  const entry: MongooseQueryEntry = { ...meta, duration: 0, startedAt, streaming: true };
  appendCollectorEntry<MongooseQueryEntry>(profile, MONGOOSE_QUERIES_KEY, entry);

  if (cursor == null || typeof (cursor as LifecycleCursor).once !== 'function') return;
  const emitter = cursor as LifecycleCursor;
  let finalized = false;
  const finalize = (error?: string): void => {
    if (finalized) return;
    finalized = true;
    entry.duration = Date.now() - startedAt;
    if (error !== undefined) entry.error = error;
  };
  emitter.once('close', () => finalize());
  emitter.once('end', () => finalize());
  emitter.once('error', (err: unknown) =>
    finalize(err instanceof Error ? err.message : String(err)),
  );
}
