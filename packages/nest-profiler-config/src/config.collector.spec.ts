import { Test } from '@nestjs/testing';
import { ConfigCollectorModule } from './config-collector.module';
import { ConfigModule, ConfigService, registerAs } from '@nestjs/config';
import { ConfigCollector } from './config.collector';
import type { ConfigCollectorData, ConfigGroup } from './config.collector';
import { CONFIG_COLLECTOR_OPTIONS } from './config-collector.module';
import type { ModuleMetadata } from '@nestjs/common';
import type { Profile } from '@eleven-labs/nest-profiler';

type ModuleImports = NonNullable<ModuleMetadata['imports']>;

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

/** Returns the entries of the named group, or an empty object when the group is absent. */
function group(result: ConfigCollectorData, name: string): Record<string, unknown> {
  const found = result.groups.find((g: ConfigGroup) => g.name === name);
  return found ? found.entries : {};
}

function groupNames(result: ConfigCollectorData): string[] {
  return result.groups.map((g) => g.name);
}

async function createCollectorFrom(
  imports: ModuleImports,
  options: { maskKeys?: string[] } = {},
): Promise<ConfigCollector> {
  const module = await Test.createTestingModule({
    imports,
    providers: [{ provide: CONFIG_COLLECTOR_OPTIONS, useValue: options }, ConfigCollector],
  }).compile();

  const collector = module.get(ConfigCollector);
  collector.onApplicationBootstrap();
  return collector;
}

async function createCollector(
  load?: () => Record<string, unknown>,
  options: { maskKeys?: string[] } = {},
): Promise<ConfigCollector> {
  return createCollectorFrom(
    [
      load
        ? ConfigModule.forRoot({ load: [load], isGlobal: true })
        : ConfigModule.forRoot({ isGlobal: true }),
    ],
    options,
  );
}

describe('ConfigCollector', () => {
  it('returns no groups when no load factories are provided', async () => {
    const collector = await createCollector();
    const result = collector.collect(makeProfile());
    expect(result.groups).toEqual([]);
    expect(result.keyCount).toBe(0);
    expect(collector.getBadgeValue(makeProfile())).toBeNull();
  });

  it('groups nested config by namespace and masks secrets', async () => {
    const collector = await createCollector(() => ({
      db: { host: 'localhost', password: 'secret' },
      port: 3000,
    }));
    const result = collector.collect(makeProfile());
    // A nested object at the top level becomes its own group, with keys relative to it.
    expect(group(result, 'db')['host']).toBe('localhost');
    expect(group(result, 'db')['password']).toBe('[REDACTED]');
    // Scalar top-level values are gathered under the synthetic "General" group.
    expect(group(result, 'General')['port']).toBe(3000);
    expect(result.keyCount).toBe(3);
  });

  it('masks user-specified keys', async () => {
    const collector = await createCollector(() => ({ MY_KEY: 'sensitive' }), {
      maskKeys: ['MY_KEY'],
    });
    const result = collector.collect(makeProfile());
    expect(group(result, 'General')['MY_KEY']).toBe('[REDACTED]');
  });

  it('getBadgeValue shows total key count across groups', async () => {
    const collector = await createCollector(() => ({ a: 1, b: 2, c: 3 }));
    expect(collector.getBadgeValue(makeProfile())).toBe('3');
  });

  it('includes runtime info with nestVersion', async () => {
    const collector = await createCollector();
    const result = collector.collect(makeProfile());
    expect(result.runtime.nodeVersion).toMatch(/^v\d+/);
    expect(typeof result.runtime.nestVersion).toBe('string');
    expect(typeof result.runtime.pid).toBe('number');
  });

  it('collector injects a real ConfigService', async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [{ provide: CONFIG_COLLECTOR_OPTIONS, useValue: {} }, ConfigCollector],
    }).compile();

    expect(module.get(ConfigCollector)).toBeInstanceOf(ConfigCollector);
    expect(module.get(ConfigService)).toBeInstanceOf(ConfigService);
  });

  it('getTemplatePath returns an absolute path ending with config-panel.ejs', async () => {
    const collector = await createCollector();
    expect(collector.getTemplatePath()).toMatch(/config-panel\.ejs$/);
  });

  describe('namespace grouping (registerAs)', () => {
    // A fresh factory per test — `registerAs` factories carry DI-token state that leaks between
    // testing modules when shared.
    const makeDatabaseConfig = () =>
      registerAs('database', () => ({ host: 'localhost', port: 5432, password: 'secret' }));

    it('captures a namespace loaded via ConfigModule.forFeature', async () => {
      const collector = await createCollectorFrom([
        ConfigModule.forRoot({ isGlobal: true }),
        ConfigModule.forFeature(makeDatabaseConfig()),
      ]);
      const result = collector.collect(makeProfile());

      expect(groupNames(result)).toContain('database');
      // Keys are shown relative to the namespace, not as `database.host`.
      expect(group(result, 'database')['host']).toBe('localhost');
      expect(group(result, 'database')['port']).toBe(5432);
      // Secrets are still masked on the feature-scoped path.
      expect(group(result, 'database')['password']).toBe('[REDACTED]');
    });

    it('captures the same namespace loaded via forRoot({ load })', async () => {
      const collector = await createCollectorFrom([
        ConfigModule.forRoot({ isGlobal: true, load: [makeDatabaseConfig()] }),
      ]);
      const result = collector.collect(makeProfile());

      expect(group(result, 'database')['host']).toBe('localhost');
      expect(group(result, 'database')['password']).toBe('[REDACTED]');
    });

    it('masks a namespaced key by its fully-qualified path via maskKeys', () => {
      // Built directly (not through Nest DI): a global @nestjs/config ConfigModule leaks state
      // across the many TestingModules in this process, which intermittently drops the options
      // provider when `forFeature` is also imported. The qualified-key masking logic under test
      // is DI-independent, so we feed a fake ConfigService instead.
      const fake = {
        internalConfig: { database: { host: 'localhost', port: 5432, password: 'secret' } },
      } as unknown as ConfigService;
      const collector = new ConfigCollector(fake, { maskKeys: ['database.port'] });
      collector.onApplicationBootstrap();
      const result = collector.collect(makeProfile());
      // `port` alone is not sensitive, but the qualified path is in maskKeys.
      expect(group(result, 'database')['port']).toBe('[REDACTED]');
      // `password` is still masked by name, `host` is untouched.
      expect(group(result, 'database')['password']).toBe('[REDACTED]');
      expect(group(result, 'database')['host']).toBe('localhost');
    });

    it('flattens deeply nested namespace values with dot notation relative to the group', () => {
      const fake = {
        internalConfig: { database: { host: 'localhost', pool: { max: 10, min: 2 } } },
      } as unknown as ConfigService;
      const collector = new ConfigCollector(fake, {});
      collector.onApplicationBootstrap();
      const result = collector.collect(makeProfile());
      expect(group(result, 'database')['host']).toBe('localhost');
      expect(group(result, 'database')['pool.max']).toBe(10);
      expect(group(result, 'database')['pool.min']).toBe(2);
    });

    it('never exposes the validated env firehose (_PROCESS_ENV_VALIDATED)', () => {
      const fake = {
        internalConfig: { _PROCESS_ENV_VALIDATED: { SECRET: 'x' }, app: { name: 'demo' } },
      } as unknown as ConfigService;
      const collector = new ConfigCollector(fake, {});
      collector.onApplicationBootstrap();
      const result = collector.collect(makeProfile());
      expect(groupNames(result)).toEqual(['app']);
      expect(result.keyCount).toBe(1);
    });

    it('sorts namespace groups and keeps General first', async () => {
      const redisConfig = registerAs('redis', () => ({ host: 'localhost' }));
      const collector = await createCollectorFrom([
        ConfigModule.forRoot({ isGlobal: true, load: [() => ({ appName: 'demo' })] }),
        ConfigModule.forFeature(redisConfig),
        ConfigModule.forFeature(makeDatabaseConfig()),
      ]);
      const result = collector.collect(makeProfile());
      expect(groupNames(result)).toEqual(['General', 'database', 'redis']);
    });
  });

  describe('without a usable ConfigService', () => {
    it('returns no groups and a null badge when no ConfigService is injected', () => {
      const collector = new ConfigCollector(undefined as unknown as ConfigService, {});
      collector.onApplicationBootstrap();
      expect(collector.collect(makeProfile()).groups).toEqual([]);
      expect(collector.collect(makeProfile()).keyCount).toBe(0);
      expect(collector.getBadgeValue(makeProfile())).toBeNull();
    });

    it('falls back to no groups when reading the internal config throws', () => {
      const throwing = {
        get internalConfig(): never {
          throw new Error('boom');
        },
      } as unknown as ConfigService;
      const collector = new ConfigCollector(throwing, {});
      collector.onApplicationBootstrap();
      expect(collector.collect(makeProfile()).groups).toEqual([]);
    });

    it('ignores a non-object internal config', () => {
      const weird = { internalConfig: 'not-an-object' } as unknown as ConfigService;
      // Constructed without options to exercise the default options value.
      const collector = new ConfigCollector(weird);
      collector.onApplicationBootstrap();
      expect(collector.collect(makeProfile()).groups).toEqual([]);
    });
  });

  it('falls back to nestVersion "unknown" when @nestjs/core version is unreadable', () => {
    // Isolated module registry so the mocked (throwing) package.json only affects this test's
    // freshly-required collector, exercising the version-resolution catch.
    jest.isolateModules(() => {
      jest.doMock('@nestjs/core/package.json', () => {
        throw new Error('boom');
      });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('./config.collector') as typeof import('./config.collector');
      const collector = new mod.ConfigCollector(undefined as unknown as ConfigService, {});
      collector.onApplicationBootstrap();
      expect(collector.collect(makeProfile()).runtime.nestVersion).toBe('unknown');
      jest.dontMock('@nestjs/core/package.json');
    });
  });

  it('reports env as "unknown" when NODE_ENV is unset', () => {
    const saved = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      const collector = new ConfigCollector(undefined as unknown as ConfigService, {});
      collector.onApplicationBootstrap();
      expect(collector.collect(makeProfile()).runtime.env).toBe('unknown');
    } finally {
      if (saved !== undefined) process.env.NODE_ENV = saved;
    }
  });
});

describe('ConfigCollectorModule.forRoot', () => {
  it('returns a no-op module when enabled is false', () => {
    expect(ConfigCollectorModule.forRoot({ enabled: false })).toEqual({
      module: ConfigCollectorModule,
    });
  });

  it('registers providers by default', () => {
    expect(ConfigCollectorModule.forRoot().providers?.length ?? 0).toBeGreaterThan(0);
  });
});
