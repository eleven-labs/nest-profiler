import * as path from 'path';
import type { Connection } from 'mongoose';
import type { ModuleRef } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { MongooseCollector } from './mongoose.collector';
import { MongooseCollectorModule } from './mongoose-collector.module';
import { MongooseConnectionPatch } from './mongoose-connection.patch';
import { MONGOOSE_QUERIES_KEY } from './mongoose-collector.interface';
import type { Profile } from '@eleven-labs/nest-profiler';
import type { MongooseQueryEntry } from './mongoose-collector.interface';

function mongooseModuleRef(cls: unknown, connection: unknown): ModuleRef {
  return { get: (t: unknown) => (t === ClsService ? cls : connection) } as unknown as ModuleRef;
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    token: 'test',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
    ...overrides,
  };
}

function makeQuery(overrides: Partial<MongooseQueryEntry> = {}): MongooseQueryEntry {
  return {
    collection: 'reviews',
    operation: 'find',
    duration: 10,
    isSlow: false,
    startedAt: Date.now(),
    ...overrides,
  };
}

describe('MongooseCollector', () => {
  let collector: MongooseCollector;

  beforeEach(() => {
    collector = new MongooseCollector();
  });

  it('returns queries with a precomputed command and removes the key from collectors', () => {
    const q = makeQuery({ operation: 'find', filter: { status: 'active' } });
    const profile = makeProfile({ collectors: { [MONGOOSE_QUERIES_KEY]: [q] } });
    const result = collector.collect(profile);
    expect(result).toEqual([
      { ...q, command: `db.reviews.find(${JSON.stringify({ status: 'active' }, null, 2)})` },
    ]);
    expect(profile.collectors[MONGOOSE_QUERIES_KEY]).toBeUndefined();
  });

  it('returns empty array when no queries', () => {
    const profile = makeProfile();
    expect(collector.collect(profile)).toEqual([]);
  });

  it('getBadgeValue returns null when no queries', () => {
    const profile = makeProfile();
    expect(collector.getBadgeValue(profile)).toBeNull();
  });

  it('getBadgeValue shows query count', () => {
    const q = makeQuery();
    const profile = makeProfile({ collectors: { [MONGOOSE_QUERIES_KEY]: [q, q] } });
    expect(collector.getBadgeValue(profile)).toBe('2q');
  });

  it('getBadgeValue includes slow count when present', () => {
    const slow = makeQuery({ isSlow: true });
    const fast = makeQuery();
    const profile = makeProfile({ collectors: { [MONGOOSE_QUERIES_KEY]: [slow, fast] } });
    expect(collector.getBadgeValue(profile)).toBe('2q (1 slow)');
  });

  it('getBadgeValue reads from profile.collectors[name] after collect() has run', () => {
    const q = makeQuery();
    const profile = makeProfile({ collectors: { [MONGOOSE_QUERIES_KEY]: [q, q] } });
    const collected = collector.collect(profile);
    profile.collectors[collector.name] = collected;
    expect(profile.collectors[MONGOOSE_QUERIES_KEY]).toBeUndefined();
    expect(collector.getBadgeValue(profile)).toBe('2q');
  });

  it('getTemplatePath returns an absolute path ending with mongoose-panel.ejs', () => {
    const p = collector.getTemplatePath();
    expect(p).toMatch(/mongoose-panel\.ejs$/);
    expect(path.isAbsolute(p)).toBe(true);
  });
});

describe('MongooseCollectorModule.forRoot', () => {
  it('returns a no-op module when enabled is false', () => {
    expect(MongooseCollectorModule.forRoot({ enabled: false })).toEqual({
      module: MongooseCollectorModule,
    });
  });

  it('registers providers by default', () => {
    expect(MongooseCollectorModule.forRoot().providers?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('MongooseConnectionPatch', () => {
  type ExecFn = ((this: unknown, ...args: unknown[]) => Promise<unknown>) & {
    __profilerPatched?: boolean;
  };
  interface FakeBase {
    Query: { prototype: { exec: ExecFn } };
    Aggregate: { prototype: { exec: ExecFn } };
  }

  function setup(
    params: {
      queryExec?: () => Promise<unknown>;
      aggExec?: () => Promise<unknown>;
      base?: unknown;
      threshold?: number;
      profile?: Profile | null;
      clsThrows?: boolean;
    } = {},
  ): { base: FakeBase; profile: Profile | null; patch: MongooseConnectionPatch } {
    const queryExec = jest.fn(params.queryExec ?? (() => Promise.resolve([{ _id: 1 }]))) as ExecFn;
    const aggExec = jest.fn(params.aggExec ?? (() => Promise.resolve([{ _id: 1 }]))) as ExecFn;
    const base = (
      params.base !== undefined
        ? params.base
        : {
            Query: { prototype: { exec: queryExec } },
            Aggregate: { prototype: { exec: aggExec } },
          }
    ) as FakeBase;

    const connection = { base } as unknown as Connection;
    const profile = params.profile === undefined ? makeProfile() : params.profile;
    const cls = {
      get: jest.fn(() => {
        if (params.clsThrows) throw new Error('outside CLS');
        return profile ?? undefined;
      }),
    } as unknown as ClsService;

    const patch = new MongooseConnectionPatch(mongooseModuleRef(cls, connection), {
      slowQueryThreshold: params.threshold,
    });
    patch.onModuleInit();
    return { base, profile, patch };
  }

  function entriesOf(profile: Profile | null): MongooseQueryEntry[] {
    return (profile?.collectors[MONGOOSE_QUERIES_KEY] as MongooseQueryEntry[] | undefined) ?? [];
  }

  function firstEntry(profile: Profile | null): MongooseQueryEntry {
    const first = entriesOf(profile)[0];
    if (first === undefined) throw new Error('expected at least one collected query');
    return first;
  }

  const queryCtx = {
    model: { collection: { name: 'reviews' } },
    op: 'find',
    getFilter: () => ({ status: 'active' }),
  };

  it('does nothing when the connection has no patchable base', () => {
    expect(() => setup({ base: null })).not.toThrow();
  });

  describe('write operations (MAJ-8)', () => {
    function setupWithModel(): { base: Record<string, unknown>; profile: Profile } {
      const profile = makeProfile();
      const cls = { get: jest.fn(() => profile) } as unknown as ClsService;
      const base = {
        Query: { prototype: { exec: jest.fn(() => Promise.resolve([])) } },
        Aggregate: { prototype: { exec: jest.fn(() => Promise.resolve([])) } },
        Model: {
          prototype: {
            save: jest.fn(function (this: unknown) {
              return Promise.resolve({ _id: 1 });
            }),
            collection: { name: 'users' },
          },
          insertMany: jest.fn(() => Promise.resolve([{ _id: 1 }, { _id: 2 }])),
          bulkWrite: jest.fn(() => Promise.resolve({ ok: 1 })),
          collection: { name: 'users' },
        },
      };
      const connection = { base } as unknown as Connection;
      new MongooseConnectionPatch(mongooseModuleRef(cls, connection), {
        slowQueryThreshold: 100,
      }).onModuleInit();
      return { base, profile };
    }

    it('records document.save() as a write', async () => {
      const { base, profile } = setupWithModel();
      const model = base['Model'] as { prototype: { save: (this: unknown) => Promise<unknown> } };
      // `this` is the document; its constructor is the model carrying the collection name.
      await model.prototype.save.call({ constructor: { collection: { name: 'users' } } });
      const entries = (profile.collectors[MONGOOSE_QUERIES_KEY] as MongooseQueryEntry[]) ?? [];
      expect(entries.map((e) => e.operation)).toContain('save');
      expect(entries[0]?.collection).toBe('users');
    });

    it('records insertMany() with the inserted count', async () => {
      const { base, profile } = setupWithModel();
      const model = base['Model'] as {
        insertMany: (this: unknown, docs: unknown[]) => Promise<unknown>;
        collection: { name: string };
      };
      await model.insertMany.call(model, [{ a: 1 }, { a: 2 }]);
      const entries = (profile.collectors[MONGOOSE_QUERIES_KEY] as MongooseQueryEntry[]) ?? [];
      const entry = entries.find((e) => e.operation === 'insertMany');
      expect(entry).toBeDefined();
      expect(entry?.count).toBe(2);
    });

    it('records bulkWrite()', async () => {
      const { base, profile } = setupWithModel();
      const model = base['Model'] as {
        bulkWrite: (this: unknown, ops: unknown[]) => Promise<unknown>;
        collection: { name: string };
      };
      await model.bulkWrite.call(model, [{ insertOne: {} }]);
      const entries = (profile.collectors[MONGOOSE_QUERIES_KEY] as MongooseQueryEntry[]) ?? [];
      expect(entries.map((e) => e.operation)).toContain('bulkWrite');
    });

    it('records the error when a write rejects, then rethrows', async () => {
      const profile = makeProfile();
      const cls = { get: jest.fn(() => profile) } as unknown as ClsService;
      const base = {
        Query: { prototype: { exec: jest.fn(() => Promise.resolve([])) } },
        Aggregate: { prototype: { exec: jest.fn(() => Promise.resolve([])) } },
        Model: {
          prototype: {
            save: jest.fn(() => Promise.reject(new Error('E11000 duplicate'))),
            collection: { name: 'users' },
          },
          collection: { name: 'users' },
        },
      };
      new MongooseConnectionPatch(mongooseModuleRef(cls, { base }), {}).onModuleInit();
      const model = base.Model as { prototype: { save: (this: unknown) => Promise<unknown> } };
      await expect(
        model.prototype.save.call({ constructor: { collection: { name: 'users' } } }),
      ).rejects.toThrow('E11000 duplicate');
      const entries = (profile.collectors[MONGOOSE_QUERIES_KEY] as MongooseQueryEntry[]) ?? [];
      expect(entries.find((e) => e.operation === 'save')?.error).toContain('E11000');
    });

    it('falls back to "unknown" collection and undefined count for odd call shapes', async () => {
      const { base, profile } = setupWithModel();
      const model = base['Model'] as {
        prototype: { save: (this: unknown) => Promise<unknown> };
        insertMany: (this: unknown, docs: unknown) => Promise<unknown>;
      };
      // save on a `this` with neither collection nor constructor.collection → 'unknown'.
      await model.prototype.save.call({});
      // insertMany with a non-array first arg → count undefined.
      await model.insertMany.call({}, { a: 1 });
      const entries = (profile.collectors[MONGOOSE_QUERIES_KEY] as MongooseQueryEntry[]) ?? [];
      const save = entries.find((e) => e.operation === 'save' && e.collection === 'unknown');
      expect(save).toBeDefined();
      const insert = entries.find((e) => e.operation === 'insertMany');
      expect(insert?.count).toBeUndefined();
    });

    it('skips write patching when the mongoose base exposes no Model', () => {
      const cls = { get: jest.fn() } as unknown as ClsService;
      const base = {
        Query: { prototype: { exec: jest.fn() } },
        Aggregate: { prototype: { exec: jest.fn() } },
      };
      expect(() =>
        new MongooseConnectionPatch(mongooseModuleRef(cls, { base }), {}).onModuleInit(),
      ).not.toThrow();
    });
  });

  describe('named connection / disabled core (MAJ-18)', () => {
    it('no-ops when the named connection is absent', () => {
      const cls = { get: jest.fn() } as unknown as ClsService;
      // moduleRef resolves cls but not the named connection token → undefined.
      const moduleRef = mongooseModuleRef(cls, undefined);
      const patch = new MongooseConnectionPatch(moduleRef, { connectionName: 'analytics' });
      expect(() => patch.onModuleInit()).not.toThrow();
    });
  });

  describe('Query.exec', () => {
    it('records collection, operation, filter, count and slow flag', async () => {
      const { base, profile } = setup({ threshold: 100 });
      const result: unknown = await base.Query.prototype.exec.call(queryCtx);
      expect(result).toEqual([{ _id: 1 }]);

      const e = firstEntry(profile);
      expect(e.collection).toBe('reviews');
      expect(e.operation).toBe('find');
      expect(e.filter).toEqual({ status: 'active' });
      expect(e.count).toBe(1);
      expect(e.isSlow).toBe(false);
      expect(e.error).toBeUndefined();
    });

    it('flags slow queries when duration meets the threshold', async () => {
      const { base, profile } = setup({ threshold: 0 });
      await base.Query.prototype.exec.call(queryCtx);
      expect(firstEntry(profile).isSlow).toBe(true);
    });

    it('leaves the filter undefined when getFilter throws', async () => {
      const { base, profile } = setup({});
      await base.Query.prototype.exec.call({
        model: { collection: { name: 'c' } },
        op: 'find',
        getFilter: () => {
          throw new Error('no filter');
        },
      });
      expect(firstEntry(profile).filter).toBeUndefined();
    });

    it('defaults collection and operation to "unknown"', async () => {
      const { base, profile } = setup({});
      await base.Query.prototype.exec.call({ getFilter: () => ({}) });
      const e = firstEntry(profile);
      expect(e.collection).toBe('unknown');
      expect(e.operation).toBe('unknown');
    });

    it('omits count for non-array results', async () => {
      const { base, profile } = setup({ queryExec: () => Promise.resolve({ _id: 1 }) });
      await base.Query.prototype.exec.call(queryCtx);
      expect(firstEntry(profile).count).toBeUndefined();
    });

    it('records the error message and rethrows when the query fails', async () => {
      const { base, profile } = setup({ queryExec: () => Promise.reject(new Error('db down')) });
      await expect(base.Query.prototype.exec.call(queryCtx)).rejects.toThrow('db down');
      expect(firstEntry(profile).error).toBe('db down');
    });

    it('stringifies a non-Error rejection', async () => {
      const { base, profile } = setup({
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- testing the non-Error branch
        queryExec: () => Promise.reject('boom'),
      });
      await expect(base.Query.prototype.exec.call(queryCtx)).rejects.toBe('boom');
      expect(firstEntry(profile).error).toBe('boom');
    });

    it('does not append outside a CLS context', async () => {
      const { base, profile } = setup({ clsThrows: true });
      await base.Query.prototype.exec.call(queryCtx);
      expect(entriesOf(profile)).toHaveLength(0);
    });

    it('does not append when there is no active profile', async () => {
      const { base, profile } = setup({ profile: null });
      await base.Query.prototype.exec.call(queryCtx);
      expect(profile).toBeNull();
    });
  });

  describe('Aggregate.exec', () => {
    const aggCtx = { _model: { collection: { name: 'orders' } } };

    it('records an aggregate operation with collection and count', async () => {
      const { base, profile } = setup({ threshold: 100 });
      await base.Aggregate.prototype.exec.call(aggCtx);
      const e = firstEntry(profile);
      expect(e.operation).toBe('aggregate');
      expect(e.collection).toBe('orders');
      expect(e.count).toBe(1);
    });

    it('captures the aggregation pipeline', async () => {
      const { base, profile } = setup({ threshold: 100 });
      const pipeline = [{ $match: { status: 'active' } }, { $count: 'n' }];
      await base.Aggregate.prototype.exec.call({ ...aggCtx, _pipeline: pipeline });
      expect(firstEntry(profile).pipeline).toEqual(pipeline);
    });

    it('leaves the pipeline undefined when none is present', async () => {
      const { base, profile } = setup({ threshold: 100 });
      await base.Aggregate.prototype.exec.call(aggCtx);
      expect(firstEntry(profile).pipeline).toBeUndefined();
    });

    it('defaults the collection to "unknown" and records errors', async () => {
      const { base, profile } = setup({ aggExec: () => Promise.reject(new Error('agg fail')) });
      await expect(base.Aggregate.prototype.exec.call({})).rejects.toThrow('agg fail');
      const e = firstEntry(profile);
      expect(e.collection).toBe('unknown');
      expect(e.error).toBe('agg fail');
    });

    it('omits count for non-array aggregate results', async () => {
      const { base, profile } = setup({ aggExec: () => Promise.resolve({ total: 5 }) });
      await base.Aggregate.prototype.exec.call(aggCtx);
      expect(firstEntry(profile).count).toBeUndefined();
    });

    it('does not append outside a CLS context', async () => {
      const { base, profile } = setup({ clsThrows: true });
      await base.Aggregate.prototype.exec.call(aggCtx);
      expect(entriesOf(profile)).toHaveLength(0);
    });

    it('does not append when there is no active profile', async () => {
      const { base, profile } = setup({ profile: null });
      await base.Aggregate.prototype.exec.call(aggCtx);
      expect(profile).toBeNull();
    });
  });

  it('uses the default threshold when no options are provided', async () => {
    const queryExec = jest.fn(() => Promise.resolve([{ _id: 1 }])) as ExecFn;
    const aggExec = jest.fn(() => Promise.resolve([])) as ExecFn;
    const base: FakeBase = {
      Query: { prototype: { exec: queryExec } },
      Aggregate: { prototype: { exec: aggExec } },
    };
    const profile = makeProfile();
    const cls = { get: jest.fn(() => profile) } as unknown as ClsService;
    // Third argument omitted → exercises the default `options = {}` parameter.
    const patch = new MongooseConnectionPatch(mongooseModuleRef(cls, { base }));
    patch.onModuleInit();

    await base.Query.prototype.exec.call(queryCtx);
    // Fast query stays under the default 100ms threshold.
    expect(firstEntry(profile).isSlow).toBe(false);
  });

  describe('redaction and named connection', () => {
    it('redacts sensitive keys in the recorded query filter', async () => {
      const { base, profile } = setup({ threshold: 100 });
      await base.Query.prototype.exec.call({
        model: { collection: { name: 'users' } },
        op: 'findOne',
        getFilter: () => ({ email: 'a@b.c', password: 'hunter2', token: 'abc123' }),
      });
      expect(firstEntry(profile).filter).toEqual({
        email: 'a@b.c',
        password: '[REDACTED]',
        token: '[REDACTED]',
      });
    });

    it('redacts sensitive values inside the aggregation pipeline', async () => {
      const { base, profile } = setup({ threshold: 100 });
      await base.Aggregate.prototype.exec.call({
        _model: { collection: { name: 'users' } },
        _pipeline: [{ $match: { apiKey: 'secret-key' } }],
      });
      expect(firstEntry(profile).pipeline).toEqual([{ $match: { apiKey: '[REDACTED]' } }]);
    });

    it('patches a named connection resolved via its connection token', async () => {
      const profile = makeProfile();
      const cls = { get: jest.fn(() => profile) } as unknown as ClsService;
      const base: FakeBase = {
        Query: { prototype: { exec: jest.fn(() => Promise.resolve([{ _id: 1 }])) } },
        Aggregate: { prototype: { exec: jest.fn(() => Promise.resolve([])) } },
      };
      const connection = { base } as unknown as Connection;
      // The moduleRef resolves the analytics connection token → the patch targets it.
      new MongooseConnectionPatch(mongooseModuleRef(cls, connection), {
        connectionName: 'analytics',
      }).onModuleInit();

      await base.Query.prototype.exec.call(queryCtx);
      expect(firstEntry(profile).collection).toBe('reviews');
    });
  });

  it('patches each prototype only once (idempotent)', () => {
    const { base, patch } = setup({});
    const patchedQueryExec = base.Query.prototype.exec;
    const patchedAggExec = base.Aggregate.prototype.exec;
    patch.onModuleInit();
    expect(base.Query.prototype.exec).toBe(patchedQueryExec);
    expect(base.Aggregate.prototype.exec).toBe(patchedAggExec);
  });
});
