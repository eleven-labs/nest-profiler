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

  it('builds db.<collection>.save(<document>) from the single saved document', () => {
    const documents = [{ _id: 'abc', name: 'ada' }];
    const cmd = buildMongoCommand(entry({ operation: 'save', documents }));
    expect(cmd).toBe(`db.users.save(${JSON.stringify(documents[0], null, 2)})`);
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
