import * as path from 'path';
import type { MikroORM, LogContext, Logger } from '@mikro-orm/core';
import type { ModuleRef } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';

// MikroORM v7 is ESM-only; the patch imports `MikroORM` as a runtime DI token. Stub it so the
// CommonJS jest runtime never parses the real ESM entry (the patch is constructed directly here).
jest.mock('@mikro-orm/core', () => ({ MikroORM: class MikroORM {} }));
// @mikro-orm/nestjs is ESM-only too; stub the token helper used by the collector module.
jest.mock('@mikro-orm/nestjs', () => ({ getMikroORMToken: (name: string) => `MikroORM_${name}` }));

import type { Profile, QueryEntry } from '@eleven-labs/nest-profiler';
import { MikroOrmCollector } from './mikro-orm.collector.js';
import { MikroOrmCollectorModule } from './mikro-orm-collector.module.js';
import { MIKRO_ORM_QUERIES_KEY, MikroOrmLoggerPatch } from './mikro-orm-logger.patch.js';

function mikroModuleRef(cls: unknown, orm: unknown): ModuleRef {
  return { get: (t: unknown) => (t === ClsService ? cls : orm) } as unknown as ModuleRef;
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

function makeQuery(overrides: Partial<QueryEntry> = {}): QueryEntry {
  return {
    sql: 'select * from product',
    duration: 10,
    type: 'SELECT',
    startedAt: Date.now(),
    ...overrides,
  };
}

const slowTag = { id: 'slow', label: 'Slow', severity: 'warning' as const };

describe('MikroOrmCollector', () => {
  let collector: MikroOrmCollector;

  beforeEach(() => {
    collector = new MikroOrmCollector();
  });

  it('has the mikro-orm name and database group', () => {
    expect(collector.name).toBe('mikro-orm');
    expect(collector.group).toBe('database');
  });

  it('returns the private queries key entries and removes them from collectors', () => {
    const q = makeQuery();
    const profile = makeProfile({ collectors: { [MIKRO_ORM_QUERIES_KEY]: [q] } });
    expect(collector.collect(profile)).toEqual([{ ...q, fingerprint: 'select * from product' }]);
    expect(profile.collectors[MIKRO_ORM_QUERIES_KEY]).toBeUndefined();
  });

  it('getBadgeValue is a plain query count; getBadgeSeverity reflects the tags', () => {
    const slow = makeQuery({ tags: [slowTag] });
    const fast = makeQuery();
    const profile = makeProfile({ collectors: { [MIKRO_ORM_QUERIES_KEY]: [slow, fast] } });
    expect(collector.getBadgeValue(profile)).toBe('2q');
    expect(collector.getBadgeSeverity(profile)).toBe('warning');
  });

  it('getTagConfig returns defaults, and the configured thresholds when provided', () => {
    expect(new MikroOrmCollector().getTagConfig()).toMatchObject({
      slowThreshold: 100,
      nPlusOneThreshold: 2,
    });
    expect(new MikroOrmCollector({ slowThreshold: 15 }).getTagConfig().slowThreshold).toBe(15);
  });

  it('getTemplatePath returns an absolute path ending with sql-panel.ejs', () => {
    const p = collector.getTemplatePath();
    expect(p).toMatch(/sql-panel\.ejs$/);
    expect(path.isAbsolute(p)).toBe(true);
  });
});

describe('MikroOrmCollectorModule.forRoot', () => {
  it('returns a no-op module when enabled is false', () => {
    expect(MikroOrmCollectorModule.forRoot({ enabled: false })).toEqual({
      module: MikroOrmCollectorModule,
    });
  });

  it('registers providers by default', () => {
    expect(MikroOrmCollectorModule.forRoot().providers?.length ?? 0).toBeGreaterThan(0);
  });

  it('no-ops when the ORM context is absent (MAJ-18/disabled core)', () => {
    const cls = { get: jest.fn() } as unknown as ClsService;
    const moduleRef = {
      get: (t: unknown) => (t === ClsService ? cls : undefined),
    } as unknown as ModuleRef;
    const patch = new MikroOrmLoggerPatch(moduleRef, {});
    expect(() => patch.onModuleInit()).not.toThrow();
  });
});

describe('MikroOrmLoggerPatch', () => {
  function setup(
    params: {
      profile?: Profile | null;
      clsThrows?: boolean;
      queryEnabled?: boolean;
      hasLogger?: boolean;
      configValues?: Record<string, unknown>;
    } = {},
  ): {
    logger: Logger;
    logQuerySpy: jest.Mock;
    profile: Profile | null;
  } {
    const logQuerySpy = jest.fn();
    const logger = {
      logQuery: logQuerySpy,
      isEnabled: jest.fn((ns: string) => (ns === 'query' ? (params.queryEnabled ?? false) : true)),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      setDebugMode: jest.fn(),
    } as unknown as Logger;

    const orm = {
      config: {
        getLogger: () => (params.hasLogger === false ? undefined : logger),
        get: (key: string) => params.configValues?.[key],
      },
    } as unknown as MikroORM;

    const profile = params.profile === undefined ? makeProfile() : params.profile;
    const cls = {
      get: jest.fn(() => {
        if (params.clsThrows) throw new Error('outside CLS');
        return profile ?? undefined;
      }),
    } as unknown as ClsService;

    const patch = new MikroOrmLoggerPatch(mikroModuleRef(cls, orm), {});
    patch.onModuleInit();
    return { logger, logQuerySpy, profile };
  }

  function entriesOf(profile: Profile | null): QueryEntry[] {
    return (profile?.collectors[MIKRO_ORM_QUERIES_KEY] as QueryEntry[] | undefined) ?? [];
  }

  function firstEntry(profile: Profile | null): QueryEntry {
    const first = entriesOf(profile)[0];
    if (first === undefined) throw new Error('expected at least one collected query');
    return first;
  }

  function ctx(overrides: Partial<LogContext> = {}): LogContext {
    return { query: 'select * from product', params: [1], took: 5, ...overrides };
  }

  it('does nothing when the ORM has no logger', () => {
    const { profile } = setup({ hasLogger: false });
    expect(profile && entriesOf(profile)).toHaveLength(0);
  });

  it('captures sql, parameters, type and duration for a query', () => {
    const { logger, profile } = setup({});
    logger.logQuery(ctx());
    const e = firstEntry(profile);
    expect(e.sql).toBe('select * from product');
    expect(e.parameters).toEqual([1]);
    expect(e.type).toBe('SELECT');
    expect(e.duration).toBe(5);
  });

  it('defaults parameters to an empty array and duration to 0 when absent', () => {
    const { logger, profile } = setup({});
    logger.logQuery(ctx({ params: undefined, took: undefined }));
    const e = firstEntry(profile);
    expect(e.parameters).toEqual([]);
    expect(e.duration).toBe(0);
  });

  it('flags a streaming read (SELECT logged without `took`) with streaming:true and duration 0', () => {
    // MikroORM's `AbstractSqlConnection.stream()` calls `logQuery` at stream start, before rows are
    // consumed, so a streamed SELECT carries no `took`. It is captured and flagged `streaming`;
    // duration stays 0 (documented) because measuring it would require wrapping the row stream.
    const { logger, profile } = setup({});
    logger.logQuery(ctx({ took: undefined }));
    const e = firstEntry(profile);
    expect(e.sql).toBe('select * from product');
    expect(e.type).toBe('SELECT');
    expect(e.duration).toBe(0);
    expect(e.streaming).toBe(true);
    expect(e.error).toBeUndefined();
  });

  it('does not flag transaction/savepoint control (type OTHER without `took`) as streaming', () => {
    const { logger, profile } = setup({});
    logger.logQuery(ctx({ query: 'SAVEPOINT trx1', took: undefined }));
    expect(firstEntry(profile).streaming).toBeUndefined();
  });

  it('does not flag a normal SELECT (with `took`) as streaming', () => {
    const { logger, profile } = setup({});
    logger.logQuery(ctx());
    expect(firstEntry(profile).streaming).toBeUndefined();
  });

  it('captures rowCount from the affected count for a write', () => {
    const { logger, profile } = setup({});
    logger.logQuery(ctx({ query: 'update product set x = 1', ...({ affected: 0 } as object) }));
    expect(firstEntry(profile).rowCount).toBe(0);
  });

  it('captures rowCount from the results count for a read', () => {
    const { logger, profile } = setup({});
    logger.logQuery(ctx({ ...({ results: 7 } as object) }));
    expect(firstEntry(profile).rowCount).toBe(7);
  });

  it('leaves rowCount undefined when the context carries neither affected nor results', () => {
    const { logger, profile } = setup({});
    logger.logQuery(ctx());
    expect(firstEntry(profile).rowCount).toBeUndefined();
  });

  it('captures connection and database from the ORM config', () => {
    const { logger, profile } = setup({
      configValues: { host: 'db.internal', port: 5433, dbName: 'shop' },
    });
    logger.logQuery(ctx());
    const e = firstEntry(profile);
    expect(e.connection).toBe('db.internal:5433');
    expect(e.database).toBe('shop');
  });

  it('falls back to the context connection name when the config has no host/port', () => {
    const { logger, profile } = setup({});
    logger.logQuery(ctx({ ...({ connection: { name: 'read-replica' } } as object) }));
    expect(firstEntry(profile).connection).toBe('read-replica');
  });

  it('records a failure marker when the log level is error', () => {
    const { logger, profile } = setup({});
    logger.logQuery(ctx({ level: 'error' }));
    expect(firstEntry(profile).error).toBe('Query failed');
  });

  it('surfaces the real error message from the log context when present (MIN-17)', () => {
    const { logger, profile } = setup({});
    logger.logQuery(ctx({ level: 'error', ...({ error: new Error('duplicate key') } as object) }));
    expect(firstEntry(profile).error).toBe('duplicate key');
  });

  it('accepts a string error on the log context', () => {
    const { logger, profile } = setup({});
    logger.logQuery(ctx({ level: 'error', ...({ error: 'constraint violation' } as object) }));
    expect(firstEntry(profile).error).toBe('constraint violation');
  });

  it('ignores log calls without a query', () => {
    const { logger, profile } = setup({});
    logger.logQuery(ctx({ query: undefined }));
    expect(entriesOf(profile)).toHaveLength(0);
  });

  it('does not append outside a CLS context', () => {
    const { logger, profile } = setup({ clsThrows: true });
    logger.logQuery(ctx());
    expect(entriesOf(profile)).toHaveLength(0);
  });

  it('does not append when there is no active profile', () => {
    const { logger, profile } = setup({ profile: null });
    logger.logQuery(ctx());
    expect(profile).toBeNull();
  });

  it('forces query logging on while delegating other namespaces to the original', () => {
    const { logger } = setup({ queryEnabled: false });
    expect(logger.isEnabled('query')).toBe(true);
    expect(logger.isEnabled('discovery')).toBe(true);
  });

  it('delegates to the original logger only when query logging was already enabled', () => {
    const enabled = setup({ queryEnabled: true });
    enabled.logger.logQuery(ctx());
    expect(enabled.logQuerySpy).toHaveBeenCalledTimes(1);

    const disabled = setup({ queryEnabled: false });
    disabled.logger.logQuery(ctx());
    expect(disabled.logQuerySpy).not.toHaveBeenCalled();
  });

  it('does not double-wrap the logger when onModuleInit runs twice', () => {
    const logQuerySpy = jest.fn();
    const logger = {
      logQuery: logQuerySpy,
      isEnabled: jest.fn((ns: string) => ns !== 'query'),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      setDebugMode: jest.fn(),
    } as unknown as Logger;
    const orm = { config: { getLogger: () => logger } } as unknown as MikroORM;
    const profile = makeProfile();
    const cls = { get: jest.fn(() => profile) } as unknown as ClsService;
    const patch = new MikroOrmLoggerPatch(mikroModuleRef(cls, orm), {});
    patch.onModuleInit();
    patch.onModuleInit(); // second init must be a no-op (idempotency guard)

    logger.logQuery(ctx());
    expect(entriesOf(profile)).toHaveLength(1);
  });
});
