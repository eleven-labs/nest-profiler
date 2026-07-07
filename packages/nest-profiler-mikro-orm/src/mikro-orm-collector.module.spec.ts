import type { DynamicModule, FactoryProvider, Provider, ValueProvider } from '@nestjs/common';

// MikroORM v7 (and @mikro-orm/nestjs) are ESM-only; the logger patch imports `MikroORM` as a
// runtime DI token and `getMikroORMToken`. Stub both so the CommonJS jest runtime never parses
// the real ESM entries.
jest.mock('@mikro-orm/core', () => ({ MikroORM: class MikroORM {} }));
jest.mock('@mikro-orm/nestjs', () => ({ getMikroORMToken: (name: string) => `MikroORM_${name}` }));

import { MikroOrmCollectorModule } from './mikro-orm-collector.module.js';
import { MIKRO_ORM_COLLECTOR_OPTIONS } from './mikro-orm-collector.interface.js';
import { MikroOrmCollector } from './mikro-orm.collector.js';
import { MikroOrmLoggerPatch } from './mikro-orm-logger.patch.js';

function optionsProvider(mod: DynamicModule): Provider | undefined {
  return (mod.providers ?? []).find(
    (p): p is Provider =>
      typeof p === 'object' &&
      p !== null &&
      'provide' in p &&
      p.provide === MIKRO_ORM_COLLECTOR_OPTIONS,
  );
}

describe('MikroOrmCollectorModule.forRoot', () => {
  it('registers the logger patch, collector and the options token (useValue)', () => {
    const mod = MikroOrmCollectorModule.forRoot({ slowQueryThreshold: 50 });
    expect(mod.module).toBe(MikroOrmCollectorModule);
    expect(mod.providers).toEqual(expect.arrayContaining([MikroOrmLoggerPatch, MikroOrmCollector]));
    expect((optionsProvider(mod) as ValueProvider).useValue).toEqual({ slowQueryThreshold: 50 });
  });

  it('returns an inert module when enabled is false', () => {
    const mod = MikroOrmCollectorModule.forRoot({ enabled: false });
    expect(mod.module).toBe(MikroOrmCollectorModule);
    expect(mod.providers ?? []).not.toContain(MikroOrmCollector);
  });
});

describe('MikroOrmCollectorModule.forRootAsync', () => {
  it('provides the options token from the factory and forwards imports/inject', () => {
    class FakeImport {}
    const useFactory = (): { slowQueryThreshold: number } => ({ slowQueryThreshold: 25 });
    const mod = MikroOrmCollectorModule.forRootAsync({
      imports: [FakeImport],
      inject: ['CONFIG'],
      useFactory,
    });
    expect(mod.imports).toContain(FakeImport);
    expect(mod.providers).toEqual(expect.arrayContaining([MikroOrmLoggerPatch, MikroOrmCollector]));
    const opts = optionsProvider(mod) as FactoryProvider;
    expect(opts.useFactory).toBe(useFactory);
    expect(opts.inject).toEqual(['CONFIG']);
  });

  it('returns an inert module when enabled is false', () => {
    const mod = MikroOrmCollectorModule.forRootAsync({ enabled: false, useFactory: () => ({}) });
    expect(mod.providers ?? []).not.toContain(MikroOrmCollector);
  });
});
