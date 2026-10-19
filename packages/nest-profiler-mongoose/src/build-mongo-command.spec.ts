import { buildMongoCommand, buildMongoFingerprint } from './build-mongo-command';
import type { MongooseQueryEntry } from './mongoose-collector.interface';

function entry(overrides: Partial<MongooseQueryEntry>): MongooseQueryEntry {
  return {
    collection: 'users',
    operation: 'find',
    duration: 1,
    startedAt: 0,
    ...overrides,
  };
}

describe('buildMongoCommand', () => {
  it('builds db.<collection>.<operation>(<filter>) for queries', () => {
    const cmd = buildMongoCommand(entry({ operation: 'findOne', filter: { email: 'a@b.c' } }));
    expect(cmd).toBe(`db.users.findOne(${JSON.stringify({ email: 'a@b.c' }, null, 2)})`);
  });

  it('uses an empty object when no filter was captured', () => {
    expect(buildMongoCommand(entry({ operation: 'find' }))).toBe('db.users.find({})');
  });

  it('builds db.<collection>.<operation>(<filter>, <update>) for updates', () => {
    const filter = { id: 'abc' };
    const update = { $set: { status: 'RUNNING' } };
    const cmd = buildMongoCommand(entry({ operation: 'updateOne', filter, update }));
    expect(cmd).toBe(
      `db.users.updateOne(${JSON.stringify(filter, null, 2)}, ${JSON.stringify(update, null, 2)})`,
    );
  });

  it('builds db.<collection>.aggregate([...]) for aggregations', () => {
    const pipeline = [{ $match: { active: true } }, { $count: 'n' }];
    const cmd = buildMongoCommand(entry({ operation: 'aggregate', pipeline }));
    expect(cmd).toBe(`db.users.aggregate(${JSON.stringify(pipeline, null, 2)})`);
  });

  it('falls back to an empty pipeline when none was captured', () => {
    expect(buildMongoCommand(entry({ operation: 'aggregate' }))).toBe('db.users.aggregate([])');
  });

  it('builds db.<collection>.bulkWrite([...]) from the captured operations', () => {
    const operations = [{ updateOne: { filter: { name: 'ada' }, update: { $set: { n: 1 } } } }];
    const cmd = buildMongoCommand(entry({ operation: 'bulkWrite', operations }));
    expect(cmd).toBe(`db.users.bulkWrite(${JSON.stringify(operations, null, 2)})`);
  });

  it('builds db.<collection>.insertOne(<document>) from the single inserted document', () => {
    const documents = [{ _id: 'abc', name: 'ada' }];
    const cmd = buildMongoCommand(entry({ operation: 'insertOne', documents }));
    expect(cmd).toBe(`db.users.insertOne(${JSON.stringify(documents[0], null, 2)})`);
  });

  it('passes the options last', () => {
    const update = { $set: { 'items.$[i].qty': 2 } };
    const options = { upsert: true, arrayFilters: [{ 'i.name': 'x' }] };
    const cmd = buildMongoCommand(entry({ operation: 'updateOne', filter: {}, update, options }));
    expect(cmd).toBe(
      `db.users.updateOne({}, ${JSON.stringify(update, null, 2)}, ${JSON.stringify(options, null, 2)})`,
    );
  });

  it('passes the projection of a find second, before its options', () => {
    const cmd = buildMongoCommand(
      entry({
        operation: 'find',
        filter: { a: 1 },
        projection: { name: 1 },
        options: { limit: 2 },
      }),
    );
    expect(cmd).toBe(
      `db.users.find(${JSON.stringify({ a: 1 }, null, 2)}, ${JSON.stringify({ name: 1 }, null, 2)}, ${JSON.stringify({ limit: 2 }, null, 2)})`,
    );
  });

  it('keeps the projection slot of a find that has options only', () => {
    const cmd = buildMongoCommand(entry({ operation: 'findOne', options: { sort: { a: 1 } } }));
    expect(cmd).toBe(`db.users.findOne({}, {}, ${JSON.stringify({ sort: { a: 1 } }, null, 2)})`);
  });

  it('moves the projection into the options of an operation without a projection argument', () => {
    const cmd = buildMongoCommand(
      entry({
        operation: 'findOneAndUpdate',
        filter: {},
        update: { $inc: { n: 1 } },
        projection: { n: 1 },
        options: { returnDocument: 'after' },
      }),
    );
    expect(cmd).toBe(
      `db.users.findOneAndUpdate({}, ${JSON.stringify({ $inc: { n: 1 } }, null, 2)}, ${JSON.stringify({ returnDocument: 'after', projection: { n: 1 } }, null, 2)})`,
    );
  });

  it('builds db.<collection>.distinct(<field>, <filter>)', () => {
    const cmd = buildMongoCommand(
      entry({ operation: 'distinct', field: 'name', filter: { a: 1 } }),
    );
    expect(cmd).toBe(`db.users.distinct("name", ${JSON.stringify({ a: 1 }, null, 2)})`);
  });

  it('passes no filter to estimatedDocumentCount, which only takes options', () => {
    expect(buildMongoCommand(entry({ operation: 'estimatedDocumentCount', filter: {} }))).toBe(
      'db.users.estimatedDocumentCount()',
    );
  });

  it('passes the options of an aggregation after its pipeline', () => {
    const cmd = buildMongoCommand(
      entry({ operation: 'aggregate', pipeline: [], options: { allowDiskUse: true } }),
    );
    expect(cmd).toBe(`db.users.aggregate([], ${JSON.stringify({ allowDiskUse: true }, null, 2)})`);
  });

  it('builds db.<collection>.insertMany([...]) from the captured documents', () => {
    const documents = [{ name: 'ada' }, { name: 'grace' }];
    const cmd = buildMongoCommand(entry({ operation: 'insertMany', documents }));
    expect(cmd).toBe(`db.users.insertMany(${JSON.stringify(documents, null, 2)})`);
  });
});

describe('buildMongoFingerprint', () => {
  it('strips filter values so the same query shape shares a fingerprint', () => {
    const a = buildMongoFingerprint(entry({ operation: 'findOne', filter: { email: 'a@b.c' } }));
    const b = buildMongoFingerprint(entry({ operation: 'findOne', filter: { email: 'x@y.z' } }));
    expect(a).toBe(b);
    expect(a).toBe('findOne users {"email":"?"}');
  });

  it('keeps operators but not values, and is key-order independent', () => {
    const a = buildMongoFingerprint(entry({ filter: { age: { $gt: 18 }, name: 'bob' } }));
    const b = buildMongoFingerprint(entry({ filter: { name: 'alice', age: { $gt: 65 } } }));
    expect(a).toBe(b);
    expect(a).toBe('find users {"age":{"$gt":"?"},"name":"?"}');
  });

  it('includes the update shape, so updates of different fields do not share a fingerprint', () => {
    const status = entry({ operation: 'updateOne', filter: { id: 1 }, update: { $set: { a: 1 } } });
    const sameShape = entry({
      operation: 'updateOne',
      filter: { id: 2 },
      update: { $set: { a: 2 } },
    });
    const otherField = entry({
      operation: 'updateOne',
      filter: { id: 1 },
      update: { $set: { b: 1 } },
    });
    expect(buildMongoFingerprint(status)).toBe(buildMongoFingerprint(sameShape));
    expect(buildMongoFingerprint(status)).not.toBe(buildMongoFingerprint(otherField));
    expect(buildMongoFingerprint(status)).toBe('updateOne users {"id":"?"} {"$set":{"a":"?"}}');
  });

  it('includes the field of a distinct', () => {
    const fp = buildMongoFingerprint(
      entry({ operation: 'distinct', field: 'name', filter: { a: 1 } }),
    );
    expect(fp).toBe('distinct users name {"a":"?"}');
  });

  it('uses the operations shape for a bulkWrite', () => {
    const a = buildMongoFingerprint(
      entry({
        operation: 'bulkWrite',
        operations: [{ updateOne: { filter: { name: 'ada' }, update: { $set: { n: 1 } } } }],
      }),
    );
    const b = buildMongoFingerprint(
      entry({
        operation: 'bulkWrite',
        operations: [{ updateOne: { filter: { name: 'grace' }, update: { $set: { n: 2 } } } }],
      }),
    );
    expect(a).toBe(b);
    expect(a).toBe(
      'bulkWrite users [{"updateOne":{"filter":{"name":"?"},"update":{"$set":{"n":"?"}}}}]',
    );
  });

  it('uses the documents shape for an insertMany', () => {
    const fp = buildMongoFingerprint(
      entry({ operation: 'insertMany', documents: [{ name: 'ada' }] }),
    );
    expect(fp).toBe('insertMany users [{"name":"?"}]');
  });

  it('uses the pipeline shape for aggregations', () => {
    const fp = buildMongoFingerprint(
      entry({ operation: 'aggregate', pipeline: [{ $match: { active: true } }] }),
    );
    expect(fp).toBe('aggregate users [{"$match":{"active":"?"}}]');
  });
});
