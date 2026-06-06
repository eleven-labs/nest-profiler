import * as path from 'path';
import type { MikroORM, LogContext, Logger } from '@mikro-orm/core';
import type { ClsService } from 'nestjs-cls';

// MikroORM v7 is ESM-only; the patch imports `MikroORM` as a runtime DI token. Stub it so the
// CommonJS jest runtime never parses the real ESM entry (the patch is constructed directly here).
jest.mock('@mikro-orm/core', () => ({ MikroORM: class MikroORM {} }));

import type { Profile, QueryEntry } from '@eleven-labs/nest-profiler';
import { MikroOrmCollector } from './mikro-orm.collector.js';
import { MikroOrmCollectorModule } from './mikro-orm-collector.module.js';
import { MIKRO_ORM_QUERIES_KEY, MikroOrmLoggerPatch } from './mikro-orm-logger.patch.js';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    token: 'test',
    createdAt: Date.now(),
    request: { method: 'GET', url: '/', headers: {}, query: {} },
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
    isSlow: false,
    startedAt: Date.now(),
    ...overrides,
  };
}

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
    expect(collector.collect(profile)).toEqual([q]);
    expect(profile.collectors[MIKRO_ORM_QUERIES_KEY]).toBeUndefined();
  });

  it('getBadgeValue includes slow count when present', () => {
    const slow = makeQuery({ isSlow: true });
    const fast = makeQuery();
    const profile = makeProfile({ collectors: { [MIKRO_ORM_QUERIES_KEY]: [slow, fast] } });
    expect(collector.getBadgeValue(profile)).toBe('2q (1 slow)');
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
});

describe('MikroOrmLoggerPatch', () => {
  function setup(
    params: {
      threshold?: number;
      profile?: Profile | null;
      clsThrows?: boolean;
      queryEnabled?: boolean;
      hasLogger?: boolean;
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
      config: { getLogger: () => (params.hasLogger === false ? undefined : logger) },
    } as unknown as MikroORM;

    const profile = params.profile === undefined ? makeProfile() : params.profile;
    const cls = {
      get: jest.fn(() => {
        if (params.clsThrows) throw new Error('outside CLS');
        return profile ?? undefined;
      }),
    } as unknown as ClsService;

    const patch = new MikroOrmLoggerPatch(cls, orm, { slowQueryThreshold: params.threshold });
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
    const { logger, profile } = setup({ threshold: 100 });
    logger.logQuery(ctx());
    const e = firstEntry(profile);
    expect(e.sql).toBe('select * from product');
    expect(e.parameters).toEqual([1]);
    expect(e.type).toBe('SELECT');
    expect(e.duration).toBe(5);
    expect(e.isSlow).toBe(false);
  });

  it('defaults parameters to an empty array and duration to 0 when absent', () => {
    const { logger, profile } = setup({});
    logger.logQuery(ctx({ params: undefined, took: undefined }));
    const e = firstEntry(profile);
    expect(e.parameters).toEqual([]);
    expect(e.duration).toBe(0);
  });

  it('flags slow queries when the duration meets the threshold', () => {
    const { logger, profile } = setup({ threshold: 5 });
    logger.logQuery(ctx({ took: 5 }));
    expect(firstEntry(profile).isSlow).toBe(true);
  });

  it('records a failure marker when the log level is error', () => {
    const { logger, profile } = setup({});
    logger.logQuery(ctx({ level: 'error' }));
    expect(firstEntry(profile).error).toBe('Query failed');
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

  it('uses the default threshold when no options are provided', () => {
    const logQuerySpy = jest.fn();
    const logger = {
      logQuery: logQuerySpy,
      isEnabled: jest.fn(() => false),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      setDebugMode: jest.fn(),
    } as unknown as Logger;
    const orm = { config: { getLogger: () => logger } } as unknown as MikroORM;
    const profile = makeProfile();
    const cls = { get: jest.fn(() => profile) } as unknown as ClsService;
    // Third argument omitted → exercises the default `options = {}` parameter.
    const patch = new MikroOrmLoggerPatch(cls, orm);
    patch.onModuleInit();

    logger.logQuery(ctx({ took: 50 }));
    expect(firstEntry(profile).isSlow).toBe(false);
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
    const patch = new MikroOrmLoggerPatch(cls, orm, { slowQueryThreshold: 100 });
    patch.onModuleInit();
    patch.onModuleInit(); // second init must be a no-op (idempotency guard)

    logger.logQuery(ctx());
    expect(entriesOf(profile)).toHaveLength(1);
  });
});
