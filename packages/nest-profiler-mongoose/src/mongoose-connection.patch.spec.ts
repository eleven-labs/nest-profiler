import type { ClsService } from 'nestjs-cls';
import type { ModuleRef } from '@nestjs/core';
import { ClsService as ClsServiceToken } from 'nestjs-cls';
import type { Profile } from '@eleven-labs/nest-profiler';
import { MongooseConnectionPatch, resultCount, safeResult } from './mongoose-connection.patch';
import { MONGOOSE_QUERIES_KEY } from './mongoose-collector.interface';
import type {
  MongooseCollectorModuleOptions,
  MongooseQueryEntry,
} from './mongoose-collector.interface';

function makeProfile(): Profile {
  return {
    token: 'test',
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

/**
 * Installs the patch against a fake connection/CLS pair and runs one `Query.exec()` for the
 * given operation, returning the entry it appended to the profile.
 */
async function execEntry(
  operation: string,
  queryResult: unknown,
  options: MongooseCollectorModuleOptions = {},
): Promise<MongooseQueryEntry> {
  const profile = makeProfile();
  const cls = { get: (): Profile => profile } as unknown as ClsService;
  const base = makeMongooseBase(queryResult);
  const connection = { base, host: 'localhost', port: 27017, name: 'test-db' };
  const moduleRef = {
    get: (token: unknown): unknown => (token === ClsServiceToken ? cls : connection),
  } as unknown as ModuleRef;

  new MongooseConnectionPatch(moduleRef, options).onModuleInit();

  const query = {
    op: operation,
    model: { collection: { name: 'users' } },
    getFilter: (): Record<string, unknown> => ({ email: 'a@b.c' }),
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
  const save = (): Promise<unknown> => Promise.resolve(undefined);
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
): Promise<MongooseQueryEntry> {
  const profile = makeProfile();
  const cls = { get: (): Profile => profile } as unknown as ClsService;
  const base = { ...makeMongooseBase([]), Model: makeModel() };
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
    expect(entry.count).toBe(1);
    expect(entry.collection).toBe('users');
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
    expect(entry.operation).toBe('save');
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

  it('captures the saved document', async () => {
    const entry = await writeEntry((model) => makeDocument(model, { name: 'ada' }).save());
    expect(entry.documents).toEqual([{ name: 'ada' }]);
    expect(entry.count).toBe(1);
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
    expect(entry.count).toBe(65);
  });
});
