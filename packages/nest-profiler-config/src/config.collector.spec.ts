import { Test } from '@nestjs/testing';
import { ConfigCollectorModule } from './config-collector.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ConfigCollector } from './config.collector';
import { CONFIG_COLLECTOR_OPTIONS } from './config-collector.module';
import type { Profile } from '@eleven-labs/nest-profiler';

function makeProfile(): Profile {
  return {
    token: 'test',
    createdAt: Date.now(),
    request: { method: 'GET', url: '/', headers: {}, query: {} },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

async function createCollector(
  load?: () => Record<string, unknown>,
  options: { maskKeys?: string[] } = {},
): Promise<ConfigCollector> {
  const module = await Test.createTestingModule({
    imports: load
      ? [ConfigModule.forRoot({ load: [load], isGlobal: true })]
      : [ConfigModule.forRoot({ isGlobal: true })],
    providers: [{ provide: CONFIG_COLLECTOR_OPTIONS, useValue: options }, ConfigCollector],
  }).compile();

  const collector = module.get(ConfigCollector);
  collector.onApplicationBootstrap();
  return collector;
}

describe('ConfigCollector', () => {
  it('returns empty config when no load factories are provided', async () => {
    const collector = await createCollector();
    const result = collector.collect(makeProfile());
    expect(result.config).toEqual({});
    expect(collector.getBadgeValue(makeProfile())).toBeNull();
  });

  it('flattens nested config and masks secrets', async () => {
    const collector = await createCollector(() => ({
      db: { host: 'localhost', password: 'secret' },
      port: 3000,
    }));
    const result = collector.collect(makeProfile());
    expect(result.config['db.host']).toBe('localhost');
    expect(result.config['db.password']).toBe('***');
    expect(result.config['port']).toBe(3000);
  });

  it('masks user-specified keys', async () => {
    const collector = await createCollector(() => ({ MY_KEY: 'sensitive' }), {
      maskKeys: ['MY_KEY'],
    });
    const result = collector.collect(makeProfile());
    expect(result.config['MY_KEY']).toBe('***');
  });

  it('getBadgeValue shows key count', async () => {
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

  describe('without a usable ConfigService', () => {
    it('returns an empty config and a null badge when no ConfigService is injected', () => {
      const collector = new ConfigCollector(undefined as unknown as ConfigService, {});
      collector.onApplicationBootstrap();
      expect(collector.collect(makeProfile()).config).toEqual({});
      expect(collector.getBadgeValue(makeProfile())).toBeNull();
    });

    it('falls back to an empty snapshot when reading the internal config throws', () => {
      const throwing = {
        get internalConfig(): never {
          throw new Error('boom');
        },
      } as unknown as ConfigService;
      const collector = new ConfigCollector(throwing, {});
      collector.onApplicationBootstrap();
      expect(collector.collect(makeProfile()).config).toEqual({});
    });

    it('ignores a non-object internal config', () => {
      const weird = { internalConfig: 'not-an-object' } as unknown as ConfigService;
      const collector = new ConfigCollector(weird, {});
      collector.onApplicationBootstrap();
      expect(collector.collect(makeProfile()).config).toEqual({});
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
