import { Inject, Injectable, Optional, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import type { Connection } from 'mongoose';
import type { Profile, SafeDataOptions } from '@eleven-labs/nest-profiler';
import {
  appendCollectorEntry,
  readProfile,
  redact,
  toSafeData,
  tryResolve,
} from '@eleven-labs/nest-profiler';
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
  getUpdate?(): unknown;
  getOptions?(): unknown;
  projection?(): unknown;
  /** Field of a `distinct` — mongoose exposes no getter for it. */
  _distinct?: unknown;
}

/** Narrow surface of mongoose.Aggregate used during patching. */
interface PatchableAggregate {
  _model?: { collection?: { name?: string } };
  _pipeline?: unknown[];
  options?: unknown;
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

/**
 * Narrow surface of the base Model used to patch write operations. `$save` is a frozen alias of
 * `save`, taken at mongoose load time — it is what `Model.create()` and `Model.insertOne()` call
 * internally, so it has to be patched alongside `save`.
 */
interface PatchableModel {
  prototype: { save?: PatchableExec; $save?: PatchableExec };
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

/**
 * What a patched write contributes to its entry: the operation it sent, the documents affected,
 * and its payload — the written documents (`insertOne`, `insertMany`), the bulk operations
 * (`bulkWrite`), or the filter and update of the `updateOne` a `save()` sends.
 */
type WrittenPayload = Pick<
  MongooseQueryEntry,
  'operation' | 'count' | 'documents' | 'operations' | 'filter' | 'update' | 'projection'
>;

/** How a patched write settled: what it resolved to, or what it threw. */
interface WriteOutcome {
  result?: unknown;
  error?: unknown;
}

/**
 * Called before a write runs, with its arguments and receiver; returns how to describe the write
 * once it settled. mongoose fills a write's payload while it runs — defaults, `_id`, timestamps,
 * casting — so only then does it describe what MongoDB received.
 */
type WriteObserver = (args: unknown[], self: unknown) => (outcome: WriteOutcome) => WrittenPayload;

/** Narrow surface of a mongoose document, as `save()` writes it. */
interface SavedDocument {
  _id?: unknown;
  isNew?: boolean;
  /** Computes `[where, update]` for the modified paths, or nothing when none was modified. */
  $__delta?: (...args: unknown[]) => unknown;
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

/** Operations taking a whole replacement document rather than update operators. */
const REPLACE_OPERATIONS = /replace/i;

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
 * Reshapes an update the way mongoose casts it before sending it: top-level fields are moved
 * under `$set` (merged with an explicit one), so the panel and the copied `mongosh` command show
 * the update MongoDB actually received — `mongosh` rejects an update without operators. A
 * replacement document and an update pipeline are sent as they are.
 */
export function normalizeUpdate(operation: string, update: unknown): unknown {
  if (update === null || typeof update !== 'object' || Array.isArray(update)) return update;
  if (REPLACE_OPERATIONS.test(operation)) return update;
  const operators: Record<string, unknown> = {};
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(update)) {
    if (key.startsWith('$')) operators[key] = value;
    else fields[key] = value;
  }
  if (Object.keys(fields).length === 0) return update;
  const $set = operators.$set;
  return {
    ...operators,
    $set: $set !== null && typeof $set === 'object' ? { ...$set, ...fields } : fields,
  };
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

/**
 * Projects the payload a write sent — the documents of an `insertOne` / `insertMany`, the
 * operations of a `bulkWrite` — into a JSON-safe, redacted array. A single value is wrapped so
 * the panel always renders an array, matching how `mongosh` takes these arguments.
 *
 * Like a query filter, the payload is an *input* to the operation and is captured in full: the
 * depth/size caps stay off, otherwise the default `maxDepth` of 4 would already collapse the
 * `$set` of a `bulkWrite` operation (`[{ updateOne: { update: { $set: … } } }]`) to `[Object]`.
 * `toSafeData` is still applied so hydrated documents go through their `toJSON` projection and
 * a circular reference or an `ObjectId` cannot break persistence.
 */
export function safeWritePayload(values: unknown): unknown[] {
  const safe = safeResult(Array.isArray(values) ? values : [values], {
    maxDepth: 0,
    maxItems: 0,
    maxStringLength: 0,
  });
  return Array.isArray(safe) ? safe : [safe];
}

/** An error's message, as recorded on an entry. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Documents a `bulkWrite` affected — inserted, modified, deleted or upserted — read off its
 * result, or off its error's when it failed part-way. Its operation count says nothing of what it
 * wrote: a bulk that matched nothing would never trip the zero-rows rule.
 */
function bulkWriteCount({ result, error }: WriteOutcome): number | undefined {
  const failure = error as { result?: unknown } | null | undefined;
  const source = failure === undefined ? result : failure?.result;
  if (source === null || typeof source !== 'object') return undefined;
  const counts = source as Record<string, unknown>;
  let total: number | undefined;
  for (const key of ['insertedCount', 'modifiedCount', 'deletedCount', 'upsertedCount']) {
    const count = counts[key];
    if (typeof count === 'number') total = (total ?? 0) + count;
  }
  return total;
}

/**
 * What an `insertMany` wrote. It resolves to the inserted documents as sent — defaults, `_id`,
 * timestamps and version key included —, to the driver's acknowledgement with `rawResult`, and
 * when it fails part-way (`ordered: false`) its error lists the documents inserted all the same.
 * The documents passed in stand in for the payload whenever the inserted ones are unknown.
 */
function insertedMany(input: unknown, { result, error }: WriteOutcome): WrittenPayload {
  if (Array.isArray(result)) {
    return { operation: 'insertMany', count: result.length, documents: safeWritePayload(result) };
  }
  const inserted = (error as { insertedDocs?: unknown } | null | undefined)?.insertedDocs;
  const acknowledged = (result as { insertedCount?: unknown } | null | undefined)?.insertedCount;
  let count: number | undefined;
  if (Array.isArray(inserted)) count = inserted.length;
  else if (typeof acknowledged === 'number') count = acknowledged;
  else if (error === undefined) count = Array.isArray(input) ? input.length : 1;
  return { operation: 'insertMany', count, documents: safeWritePayload(input) };
}

/**
 * Observes a `document.save()` to record the operation it sends rather than the call: mongoose
 * inserts a new document whole (`insertOne`), updates an existing one with the delta of its
 * modified paths (`updateOne`), and only checks that an unmodified one still exists (`findOne`).
 *
 * A new document is read once saved, the pre-save hooks having set its timestamps and version
 * key. The delta is computed during the save, after those hooks, by the document's internal
 * `$__delta()` — intercepted on that one instance, so concurrent saves never mix theirs up, and
 * restored once the save settled.
 */
const observeSave: WriteObserver = (_args, self) => {
  // `save()` only takes options: what it writes is the receiver.
  const document = self as SavedDocument;
  if (document.isNew !== false) {
    return ({ error }) => ({
      operation: 'insertOne',
      count: error === undefined ? 1 : undefined,
      documents: safeWritePayload(document),
    });
  }
  const computeDelta = document.$__delta;
  const ownDelta = Object.getOwnPropertyDescriptor(document, '$__delta');
  let computed = false;
  let delta: unknown;
  if (typeof computeDelta === 'function') {
    document.$__delta = function (this: unknown, ...args: unknown[]): unknown {
      computed = true;
      delta = computeDelta.apply(this, args);
      return delta;
    };
  }
  return ({ error }) => {
    if (ownDelta) Object.defineProperty(document, '$__delta', ownDelta);
    else delete document.$__delta;
    const count = error === undefined ? 1 : undefined;
    const [where, update] = Array.isArray(delta) ? (delta as unknown[]) : [];
    const filter = redact({
      _id: document._id,
      ...(where !== null && typeof where === 'object' ? where : {}),
    });
    // Without a delta, mongoose only checks the document exists — unless the save failed before
    // computing one (validation, a pre-save hook), in which case it sent nothing.
    if (update == null && computed) {
      return { operation: 'findOne', count, filter, projection: { _id: 1 } };
    }
    return {
      operation: 'updateOne',
      count,
      filter,
      update: update == null ? undefined : redact(update),
    };
  };
};

/** Options sent to the driver, the session left out — a live client, not an operation input. */
function driverOptions(options: unknown): Record<string, unknown> | undefined {
  if (options === null || typeof options !== 'object') return undefined;
  const { session: _session, ...rest } = options as Record<string, unknown>;
  return Object.keys(rest).length > 0 ? redact(rest) : undefined;
}

/**
 * The inputs of a query besides its filter and update — the field of a `distinct`, its
 * projection and its options —, read once it ran, as mongoose sent them.
 */
function queryInputs(
  query: PatchableQuery,
): Pick<MongooseQueryEntry, 'field' | 'projection' | 'options'> {
  try {
    const projection = query.projection?.();
    return {
      field: typeof query._distinct === 'string' ? query._distinct : undefined,
      projection:
        projection !== null && typeof projection === 'object' && Object.keys(projection).length > 0
          ? redact(projection as Record<string, unknown>)
          : undefined,
      options: driverOptions(query.getOptions?.()),
    };
  } catch {
    return {};
  }
}

/**
 * The update a query sent, read once it ran: mongoose casts it in place during `exec` — wrapping
 * top-level fields in `$set`, adding the timestamps plugin's `updatedAt` and the upsert defaults —
 * so reading it before would miss what was actually written. {@link normalizeUpdate} still
 * reshapes an update the query rejected before casting it. `redact` returns a copy, and turns a
 * `Date` or an `ObjectId` into its string form so it survives persistence.
 */
function sentUpdate(query: PatchableQuery, operation: string): unknown {
  try {
    const update = query.getUpdate?.();
    return update == null ? undefined : redact(normalizeUpdate(operation, update));
  } catch {
    // not all query types support getUpdate()
    return undefined;
  }
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
      collection: string,
      startedAt: number,
      describe: (outcome: WriteOutcome) => WrittenPayload,
      outcome: WriteOutcome,
    ): void => {
      try {
        const profile = readProfile(cls);
        if (!profile) return;
        const duration = Date.now() - startedAt;
        appendCollectorEntry<MongooseQueryEntry>(profile, MONGOOSE_QUERIES_KEY, {
          collection,
          duration,
          startedAt,
          ...describe(outcome),
          result:
            capture && outcome.result !== undefined
              ? safeResult(outcome.result, limits)
              : undefined,
          connection: meta.connection,
          database: meta.database,
          error: outcome.error === undefined ? undefined : errorMessage(outcome.error),
        });
      } catch {
        // Outside CLS context — ignore
      }
    };

    const wrap = (observe: WriteObserver) =>
      async function (this: unknown, original: PatchableExec, args: unknown[]): Promise<unknown> {
        const startedAt = Date.now();
        const collection = collectionNameOf(this);
        const describe = observe(args, this);
        const outcome: WriteOutcome = {};
        try {
          outcome.result = await original.apply(this, args);
          return outcome.result;
        } catch (err) {
          outcome.error = err;
          throw err;
        } finally {
          record(collection, startedAt, describe, outcome);
        }
      };

    /**
     * Installs `runner` over `holder[key]`, once. The wrapper targets the original function it
     * replaced, so patching two aliases of the same implementation (`save` / `$save`) still
     * records one entry per call. No-ops when the underlying mongoose build does not expose it.
     */
    const install = (holder: object, key: string, observe: WriteObserver): void => {
      const methods = holder as Record<string, PatchableExec | undefined>;
      const original = methods[key];
      if (typeof original !== 'function' || original.__profilerPatched === true) return;
      const runner = wrap(observe);
      const patched: PatchableExec = function (this: unknown, ...args: unknown[]) {
        return runner.call(this, original, args);
      };
      patched.__profilerPatched = true;
      methods[key] = patched;
    };

    // `document.save()`, and its `$save` alias: `Model.create()` / `Model.insertOne()` call
    // `$save`, which mongoose copied off `save` at load time, so patching `save` alone would
    // leave the most common write path uninstrumented.
    install(model.prototype, 'save', observeSave);
    install(model.prototype, '$save', observeSave);

    // Static Model.insertMany / Model.bulkWrite. `Model.bulkSave()` routes through bulkWrite.
    install(model, 'insertMany', (args) => (outcome) => insertedMany(args[0], outcome));
    // mongoose casts the operations in place — timestamps, `$set` — before sending them, so they
    // are read once the bulk settled.
    install(model, 'bulkWrite', (args) => (outcome) => {
      const operations = args[0];
      return Array.isArray(operations)
        ? {
            operation: 'bulkWrite',
            count: bulkWriteCount(outcome),
            operations: safeWritePayload(operations),
          }
        : { operation: 'bulkWrite' };
    });
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
          const profile = readProfile(cls);
          if (profile) {
            const entry: MongooseQueryEntry = {
              collection,
              operation,
              // Redact sensitive keys/values in the query filter (e.g. a lookup on a hashed
              // password or a token field) before persisting/displaying it.
              filter: filter ? redact(filter) : undefined,
              update: sentUpdate(this, operation),
              ...queryInputs(this),
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
          const profile = readProfile(cls);
          if (profile) {
            const entry: MongooseQueryEntry = {
              collection,
              operation: 'aggregate',
              pipeline: pipeline ? redact(pipeline) : undefined,
              options: driverOptions(this.options),
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
      const profile = readProfile(cls);
      const cursor = originalCursor.apply(this, args);
      recordCursorLifecycle(profile, cursor, startedAt, {
        collection,
        operation,
        filter: filter ? redact(filter) : undefined,
        ...queryInputs(this),
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
      const profile = readProfile(cls);
      const cursor = originalCursor.apply(this, args);
      recordCursorLifecycle(profile, cursor, startedAt, {
        collection,
        operation: 'aggregate',
        pipeline: pipeline ? redact(pipeline) : undefined,
        options: driverOptions(this.options),
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
    | 'collection'
    | 'operation'
    | 'filter'
    | 'pipeline'
    | 'field'
    | 'projection'
    | 'options'
    | 'connection'
    | 'database'
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
