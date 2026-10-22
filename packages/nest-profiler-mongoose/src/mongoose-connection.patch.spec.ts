import type { ClsService } from 'nestjs-cls';
import type { ModuleRef } from '@nestjs/core';
import { ClsService as ClsServiceToken } from 'nestjs-cls';
import type { Profile } from '@eleven-labs/nest-profiler';
import { MongooseConnectionPatch, resultCount, safeResult } from './mongoose-connection.patch.js';
import { MONGOOSE_QUERIES_KEY } from './mongoose-collector.interface.js';
import type {
  MongooseCollectorModuleOptions,
  MongooseQueryEntry,
} from './mongoose-collector.interface.js';

function makeProfile(): Profile {
  return {
    token: 'test',
    traceId: 'trace-test',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

/** Minimal mongoose surface: only what the patch reaches for. */
function makeMongooseBase(queryResult: unknown, aggregateResult: unknown = []) {
  return {
    Query: {
      prototype: {
        exec: (): Promise<unknown> => Promise.resolve(queryResult),
        cursor: (): unknown => ({ once: (): void => undefined }),
      },
    },
    Aggregate: {
      prototype: {
        exec: (): Promise<unknown> => Promise.resolve(aggregateResult),
        cursor: (): unknown => ({ once: (): void => undefined }),
      },
    },
    Model: { prototype: {} },
  };
}

/** What a fake query holds besides its operation and filter. */
interface FakeQuery {
  /** What `getUpdate()` returns before `exec` — `undefined` for a read, like mongoose. */
  update?: unknown;
  /** What `getUpdate()` returns once `exec` ran: mongoose casts the update in place. */
  sentUpdate?: unknown;
  /** What `getOptions()` returns. */
  options?: Record<string, unknown>;
  /** What `projection()` returns. */
  projection?: Record<string, unknown>;
  /** The field of a `distinct`. */
  distinct?: string;
}

/**
 * Installs the patch against a fake connection/CLS pair and runs one `Query.exec()` for the
 * given operation, returning the entry it appended to the profile.
 */
async function execEntry(
  operation: string,
  queryResult: unknown,
  options: MongooseCollectorModuleOptions = {},
  fake: FakeQuery = {},
): Promise<MongooseQueryEntry> {
  const profile = makeProfile();
  const cls = { get: (): Profile => profile } as unknown as ClsService;
  const base = makeMongooseBase(queryResult);
  const exec = base.Query.prototype.exec;
  base.Query.prototype.exec = function (this: { _update?: unknown }): Promise<unknown> {
    if ('sentUpdate' in fake) this._update = fake.sentUpdate;
    return exec();
  };
  const connection = { base, host: 'localhost', port: 27017, name: 'test-db' };
  const moduleRef = {
    get: (token: unknown): unknown => (token === ClsServiceToken ? cls : connection),
  } as unknown as ModuleRef;

  new MongooseConnectionPatch(moduleRef, options).onModuleInit();

  const query = {
    op: operation,
    model: { collection: { name: 'users' } },
    getFilter: (): Record<string, unknown> => ({ email: 'a@b.c' }),
    _update: fake.update,
    _distinct: fake.distinct,
    getUpdate(): unknown {
      return this._update;
    },
    getOptions: (): Record<string, unknown> => fake.options ?? {},
    projection: (): Record<string, unknown> | undefined => fake.projection,
    exec: base.Query.prototype.exec,
  };
  await query.exec.call(query);

  const entries = profile.collectors[MONGOOSE_QUERIES_KEY] as MongooseQueryEntry[];
  expect(entries).toHaveLength(1);
  const [entry] = entries;
  if (entry === undefined) throw new Error('the patch recorded no entry');
  return entry;
}

describe('resultCount', () => {
  it('reports the length of an array result', () => {
    expect(resultCount('find', [{ _id: 1 }, { _id: 2 }])).toBe(2);
    expect(resultCount('find', [])).toBe(0);
  });

  it('reports the number a counting operation resolves to', () => {
    expect(resultCount('countDocuments', 42)).toBe(42);
    expect(resultCount('estimatedDocumentCount', 0)).toBe(0);
  });

  it('ignores a non-finite number', () => {
    expect(resultCount('countDocuments', Number.NaN)).toBeUndefined();
  });

  it('collapses a single-document read to 1 or 0', () => {
    expect(resultCount('findOne', { _id: 1 })).toBe(1);
    expect(resultCount('findOne', null)).toBe(0);
    expect(resultCount('findOneAndUpdate', { _id: 1 })).toBe(1);
  });

  it('reads the documents affected off a write acknowledgement', () => {
    expect(resultCount('deleteMany', { acknowledged: true, deletedCount: 3 })).toBe(3);
    expect(resultCount('updateOne', { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 })).toBe(
      1,
    );
    expect(resultCount('updateMany', { matchedCount: 0, modifiedCount: 0 })).toBe(0);
  });

  it('counts an upsert as one affected document', () => {
    expect(resultCount('updateOne', { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 })).toBe(
      1,
    );
  });

  it('falls back to matchedCount when the driver reports no modifiedCount', () => {
    expect(resultCount('updateOne', { matchedCount: 2 })).toBe(2);
  });

  it('stays undefined when the shape is unknown, so the panel omits the figure', () => {
    expect(resultCount('unknown', { whatever: true })).toBeUndefined();
    expect(resultCount('updateOne', undefined)).toBeUndefined();
  });
});

describe('safeResult', () => {
  it('redacts sensitive keys and honors the size caps', () => {
    const captured = safeResult([{ email: 'a@b.c', password: 'hunter2' }], {}) as Record<
      string,
      unknown
    >[];
    expect(captured[0]).toEqual({ email: 'a@b.c', password: '[REDACTED]' });
  });

  it('caps the number of documents kept', () => {
    const docs = Array.from({ length: 5 }, (_, i) => ({ i }));
    expect(safeResult(docs, { maxItems: 2 })).toEqual([{ i: 0 }, { i: 1 }, '… +3 more']);
  });

  it('flattens a hydrated document through its toJSON projection', () => {
    // A mongoose Document is a class instance carrying internal state ($__, $isNew…); only its
    // toJSON projection is meaningful in the panel.
    class HydratedDocument {
      public $__ = { activePaths: {} };
      public toJSON(): unknown {
        return { _id: 'abc', name: 'Ada' };
      }
    }
    expect(safeResult(new HydratedDocument(), {})).toEqual({ _id: 'abc', name: 'Ada' });
  });
});

describe('MongooseConnectionPatch — Query.exec capture', () => {
  it('records the count of a countDocuments operation', async () => {
    const entry = await execEntry('countDocuments', 7);
    expect(entry.count).toBe(7);
    expect(entry.collection).toBe('users');
    expect(entry.database).toBe('test-db');
  });

  it('records 1 for a findOne that matched and 0 for one that did not', async () => {
    expect((await execEntry('findOne', { _id: 1 })).count).toBe(1);
    expect((await execEntry('findOne', null)).count).toBe(0);
  });

  it('records the documents affected by a write', async () => {
    expect((await execEntry('deleteOne', { deletedCount: 1 })).count).toBe(1);
    expect((await execEntry('updateMany', { matchedCount: 4, modifiedCount: 4 })).count).toBe(4);
  });

  it('still reports the length of a find result', async () => {
    expect((await execEntry('find', [{ _id: 1 }, { _id: 2 }, { _id: 3 }])).count).toBe(3);
  });

  it('captures the update document of an update operation, dates included', async () => {
    const startedAt = new Date('2026-01-02T03:04:05.000Z');
    const entry = await execEntry(
      'updateOne',
      { modifiedCount: 1 },
      {},
      {
        update: { $set: { status: 'RUNNING', startedAt } },
      },
    );
    expect(entry.update).toEqual({
      $set: { status: 'RUNNING', startedAt: '2026-01-02T03:04:05.000Z' },
    });
  });

  it('wraps top-level fields in $set, as mongoose does before sending the update', async () => {
    const entry = await execEntry(
      'findOneAndUpdate',
      null,
      {},
      {
        update: { status: 'DONE', $inc: { attempts: 1 } },
      },
    );
    expect(entry.update).toEqual({ $set: { status: 'DONE' }, $inc: { attempts: 1 } });
  });

  it('captures the update as sent, once mongoose cast it and added its timestamps', async () => {
    const entry = await execEntry(
      'updateOne',
      { modifiedCount: 1 },
      {},
      {
        update: { age: 37 },
        sentUpdate: { $set: { age: 37, updatedAt: new Date('2026-01-02T03:04:05.000Z') } },
      },
    );
    expect(entry.update).toEqual({ $set: { age: 37, updatedAt: '2026-01-02T03:04:05.000Z' } });
  });

  it('keeps the top-level fields of a replacement document as they are', async () => {
    const entry = await execEntry(
      'replaceOne',
      { modifiedCount: 1 },
      {},
      {
        update: { status: 'DONE' },
      },
    );
    expect(entry.update).toEqual({ status: 'DONE' });
  });

  it('keeps an update pipeline as it is', async () => {
    const pipeline = [{ $set: { total: { $add: ['$a', '$b'] } } }];
    const entry = await execEntry('updateMany', { modifiedCount: 2 }, {}, { update: pipeline });
    expect(entry.update).toEqual(pipeline);
  });

  it('redacts sensitive fields in the update document', async () => {
    const entry = await execEntry(
      'updateOne',
      { modifiedCount: 1 },
      {},
      {
        update: { $set: { password: 'hunter2' } },
      },
    );
    expect(entry.update).toEqual({ $set: { password: '[REDACTED]' } });
  });

  it('records no update for a read', async () => {
    expect((await execEntry('find', [])).update).toBeUndefined();
  });

  it('captures the options sent to the driver, leaving the session out', async () => {
    const entry = await execEntry(
      'updateOne',
      { modifiedCount: 1 },
      {},
      {
        update: { $set: { 'items.$[i].qty': 2 } },
        options: { upsert: true, arrayFilters: [{ 'i.name': 'x' }], session: { id: 'session' } },
      },
    );
    expect(entry.options).toEqual({ upsert: true, arrayFilters: [{ 'i.name': 'x' }] });
  });

  it('captures the projection of a read', async () => {
    const entry = await execEntry(
      'find',
      [],
      {},
      {
        projection: { name: 1 },
        options: { sort: { age: -1 }, skip: 5, limit: 10 },
      },
    );
    expect(entry.projection).toEqual({ name: 1 });
    expect(entry.options).toEqual({ sort: { age: -1 }, skip: 5, limit: 10 });
  });

  it('records no options nor projection when the query has none', async () => {
    const entry = await execEntry('find', [], {}, { projection: {} });
    expect(entry.options).toBeUndefined();
    expect(entry.projection).toBeUndefined();
  });

  it('captures the field of a distinct', async () => {
    expect((await execEntry('distinct', ['ada'], {}, { distinct: 'name' })).field).toBe('name');
  });

  it('omits the result payload by default', async () => {
    expect((await execEntry('find', [{ _id: 1 }])).result).toBeUndefined();
  });

  it('captures the redacted result when captureResult is enabled', async () => {
    const entry = await execEntry('find', [{ _id: 1, token: 'secret-value' }], {
      captureResult: true,
    });
    expect(entry.result).toEqual([{ _id: 1, token: '[REDACTED]' }]);
  });

  it('applies the configured resultLimits to the captured result', async () => {
    const entry = await execEntry('find', [{ _id: 1 }, { _id: 2 }, { _id: 3 }], {
      captureResult: true,
      resultLimits: { maxItems: 1 },
    });
    expect(entry.result).toEqual([{ _id: 1 }, '… +2 more']);
  });
});

/** Minimal Model surface (statics + prototype) the write patch reaches for. */
function makeModel() {
  // Like mongoose, saving an existing document computes the delta of its modified paths.
  const save = function (this: { isNew?: boolean; $__delta?: () => unknown }): Promise<unknown> {
    if (this.isNew === false) this.$__delta?.();
    return Promise.resolve(this);
  };
  return {
    // mongoose aliases `$save` onto `save` at load time — the same function object.
    prototype: { save, $save: save },
    insertMany: (docs: unknown): Promise<unknown> => Promise.resolve(docs),
    bulkWrite: (_operations: unknown[]): Promise<unknown> => Promise.resolve({ upsertedCount: 1 }),
    collection: { name: 'users' },
  };
}

type FakeModel = ReturnType<typeof makeModel>;

/** A document hydrated off the patched model prototype, the way mongoose builds one. */
function makeDocument(
  model: FakeModel,
  fields: Record<string, unknown>,
  toJSON?: () => unknown,
): { save: (...args: unknown[]) => Promise<unknown> } {
  const document = Object.assign(Object.create(model.prototype) as object, fields);
  Object.defineProperty(document, 'constructor', { value: model, enumerable: false });
  if (toJSON) Object.defineProperty(document, 'toJSON', { value: toJSON, enumerable: false });
  return document as unknown as { save: (...args: unknown[]) => Promise<unknown> };
}

/**
 * Installs the patch against a fake connection/CLS pair, runs one patched write, and returns
 * the entry it appended to the profile.
 */
async function writeEntry(
  run: (model: FakeModel) => Promise<unknown>,
  options: MongooseCollectorModuleOptions = {},
  statics: Partial<Pick<FakeModel, 'insertMany' | 'bulkWrite'>> = {},
): Promise<MongooseQueryEntry> {
  const profile = makeProfile();
  const cls = { get: (): Profile => profile } as unknown as ClsService;
  const base = { ...makeMongooseBase([]), Model: { ...makeModel(), ...statics } };
  const connection = { base, host: 'localhost', port: 27017, name: 'test-db' };
  const moduleRef = {
    get: (token: unknown): unknown => (token === ClsServiceToken ? cls : connection),
  } as unknown as ModuleRef;

  new MongooseConnectionPatch(moduleRef, options).onModuleInit();
  await run(base.Model);

  const entries = profile.collectors[MONGOOSE_QUERIES_KEY] as MongooseQueryEntry[];
  expect(entries).toHaveLength(1);
  const [entry] = entries;
  if (entry === undefined) throw new Error('the patch recorded no entry');
  return entry;
}

describe('MongooseConnectionPatch — write capture', () => {
  it('captures the operations passed to bulkWrite', async () => {
    const operations = [
      { updateOne: { filter: { name: 'ada' }, update: { $set: { active: true } }, upsert: true } },
    ];
    const entry = await writeEntry((model) => model.bulkWrite(operations));
    expect(entry.operations).toEqual(operations);
    expect(entry.collection).toBe('users');
  });

  it('captures the bulkWrite operations as sent, once mongoose cast them in place', async () => {
    const operations: { updateOne: { filter: object; update: object } }[] = [
      { updateOne: { filter: { name: 'ada' }, update: { age: 5 } } },
    ];
    const entry = await writeEntry((model) => {
      const promise = model.bulkWrite(operations);
      operations[0]!.updateOne.update = { $set: { age: 5, updatedAt: '2026-01-02T03:04:05.000Z' } };
      return promise;
    });
    expect(entry.operations).toEqual([
      {
        updateOne: {
          filter: { name: 'ada' },
          update: { $set: { age: 5, updatedAt: '2026-01-02T03:04:05.000Z' } },
        },
      },
    ]);
  });

  it('counts the documents a bulkWrite affected, not its operations', async () => {
    const entry = await writeEntry(
      (model) => model.bulkWrite([{}, {}, {}]),
      {},
      {
        bulkWrite: () =>
          Promise.resolve({
            insertedCount: 1,
            matchedCount: 3,
            modifiedCount: 2,
            deletedCount: 0,
            upsertedCount: 1,
          }),
      },
    );
    expect(entry.count).toBe(4);
  });

  it('counts 0 for a bulkWrite that matched nothing', async () => {
    const entry = await writeEntry(
      (model) =>
        model.bulkWrite([{ updateOne: { filter: { name: 'nobody' }, update: { age: 1 } } }]),
      {},
      {
        bulkWrite: () =>
          Promise.resolve({
            insertedCount: 0,
            matchedCount: 0,
            modifiedCount: 0,
            deletedCount: 0,
            upsertedCount: 0,
          }),
      },
    );
    expect(entry.count).toBe(0);
  });

  it('captures the documents an insertMany inserted, as sent', async () => {
    const entry = await writeEntry(
      (model) => model.insertMany([{ name: 'ada' }]),
      {},
      {
        insertMany: () => Promise.resolve([{ _id: 'abc', name: 'ada', __v: 0 }]),
      },
    );
    expect(entry.documents).toEqual([{ _id: 'abc', name: 'ada', __v: 0 }]);
    expect(entry.count).toBe(1);
  });

  it('counts the documents a failed insertMany inserted all the same', async () => {
    const failure = Object.assign(new Error('E11000 duplicate key'), { insertedDocs: [{}, {}] });
    const entry = await writeEntry(
      (model) =>
        model.insertMany([{ name: 'a' }, { name: 'b' }, { name: 'c' }]).catch(() => undefined),
      {},
      { insertMany: () => Promise.reject(failure) },
    );
    expect(entry.count).toBe(2);
    expect(entry.error).toBe('E11000 duplicate key');
    expect(entry.documents).toEqual([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
  });

  it('captures the documents passed to insertMany', async () => {
    const documents = [{ name: 'ada' }, { name: 'grace' }];
    const entry = await writeEntry((model) => model.insertMany(documents));
    expect(entry.documents).toEqual(documents);
    expect(entry.count).toBe(2);
  });

  it('accepts a single document passed to insertMany', async () => {
    const entry = await writeEntry((model) => model.insertMany({ name: 'ada' }));
    expect(entry.documents).toEqual([{ name: 'ada' }]);
    expect(entry.count).toBe(1);
  });

  it('records a Model.create() / Model.insertOne(), which calls the $save alias', async () => {
    // Patching `save` alone leaves this path — the most common one — uninstrumented.
    const entry = await writeEntry((model) =>
      (
        makeDocument(model, { name: 'ada' }) as unknown as { $save: () => Promise<unknown> }
      ).$save(),
    );
    expect(entry.operation).toBe('insertOne');
    expect(entry.documents).toEqual([{ name: 'ada' }]);
  });

  it('records one entry per call, not one per patched alias', async () => {
    const profile = makeProfile();
    const cls = { get: (): Profile => profile } as unknown as ClsService;
    const base = { ...makeMongooseBase([]), Model: makeModel() };
    const connection = { base, host: 'localhost', port: 27017, name: 'test-db' };
    const moduleRef = {
      get: (token: unknown): unknown => (token === ClsServiceToken ? cls : connection),
    } as unknown as ModuleRef;
    new MongooseConnectionPatch(moduleRef, {}).onModuleInit();

    await makeDocument(base.Model, { name: 'ada' }).save();

    expect(profile.collectors[MONGOOSE_QUERIES_KEY]).toHaveLength(1);
  });

  it('records the save of a new document as the insertOne it sends', async () => {
    const entry = await writeEntry((model) => makeDocument(model, { name: 'ada' }).save());
    expect(entry.operation).toBe('insertOne');
    expect(entry.documents).toEqual([{ name: 'ada' }]);
    expect(entry.count).toBe(1);
  });

  it('captures a new document as inserted, once the save filled it', async () => {
    const entry = await writeEntry((model) => {
      const document = makeDocument(model, { name: 'ada' }) as unknown as Record<
        string,
        unknown
      > & {
        save: () => Promise<unknown>;
      };
      const promise = document.save();
      // mongoose sets the timestamps and the version key while the save runs.
      Object.assign(document, { createdAt: '2026-01-02T03:04:05.000Z', __v: 0 });
      return promise;
    });
    expect(entry.documents).toEqual([
      { name: 'ada', createdAt: '2026-01-02T03:04:05.000Z', __v: 0 },
    ]);
  });

  it('records the save of a modified document as the updateOne of its delta', async () => {
    const delta = [{ __v: 3 }, { $set: { age: 37, updatedAt: '2026-01-02T03:04:05.000Z' } }];
    const entry = await writeEntry((model) => {
      const document = makeDocument(model, { _id: 'abc', isNew: false, name: 'ada', age: 37 });
      Object.defineProperty(document, '$__delta', {
        value: () => delta,
        writable: true,
        configurable: true,
      });
      return document.save();
    });
    expect(entry.operation).toBe('updateOne');
    expect(entry.filter).toEqual({ _id: 'abc', __v: 3 });
    expect(entry.update).toEqual({ $set: { age: 37, updatedAt: '2026-01-02T03:04:05.000Z' } });
    expect(entry.documents).toBeUndefined();
    expect(entry.count).toBe(1);
  });

  it('records the save of an unmodified document as the findOne mongoose checks it with', async () => {
    const entry = await writeEntry((model) => {
      const document = makeDocument(model, { _id: 'abc', isNew: false, name: 'ada' });
      Object.defineProperty(document, '$__delta', {
        value: () => undefined,
        writable: true,
        configurable: true,
      });
      return document.save();
    });
    expect(entry.operation).toBe('findOne');
    expect(entry.filter).toEqual({ _id: 'abc' });
    expect(entry.projection).toEqual({ _id: 1 });
    expect(entry.update).toBeUndefined();
  });

  it('leaves the document as it was once the save settled', async () => {
    const computeDelta = (): undefined => undefined;
    let document: Record<string, unknown> = {};
    await writeEntry((model) => {
      document = makeDocument(model, { _id: 'abc', isNew: false });
      Object.defineProperty(document, '$__delta', {
        value: computeDelta,
        writable: true,
        configurable: true,
      });
      return (document as unknown as { save: () => Promise<unknown> }).save();
    });
    expect(document.$__delta).toBe(computeDelta);
  });

  it('flattens a saved document through its toJSON projection', async () => {
    const entry = await writeEntry((model) =>
      makeDocument(model, { name: 'ada' }, () => ({ _id: 'abc', name: 'Ada' })).save(),
    );
    expect(entry.documents).toEqual([{ _id: 'abc', name: 'Ada' }]);
  });

  it('redacts sensitive fields in a captured write payload', async () => {
    const entry = await writeEntry((model) =>
      model.insertMany([{ name: 'ada', password: 'hunter2' }]),
    );
    expect(entry.documents).toEqual([{ name: 'ada', password: '[REDACTED]' }]);
  });

  it('keeps a write payload in full, past the default depth and item caps', async () => {
    // A bulkWrite operation is naturally 5 levels deep — the core's default maxDepth of 4 would
    // collapse its `$set` to '[Object]' — and a bulk of more than 64 operations would be capped.
    const operations = Array.from({ length: 65 }, (_, i) => ({
      updateOne: { filter: { i }, update: { $set: { nested: { deep: i } } } },
    }));
    const entry = await writeEntry((model) => model.bulkWrite(operations), {
      resultLimits: { maxItems: 1, maxDepth: 2 },
    });
    expect(entry.operations).toEqual(operations);
  });
});
