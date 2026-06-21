import { buildMongoCommand } from './build-mongo-command';
import type { MongooseQueryEntry } from './mongoose-collector.interface';

function entry(overrides: Partial<MongooseQueryEntry>): MongooseQueryEntry {
  return {
    collection: 'users',
    operation: 'find',
    duration: 1,
    isSlow: false,
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
});
