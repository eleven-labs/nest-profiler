import type { DynamicModule, FactoryProvider, Provider, ValueProvider } from '@nestjs/common';
import { TypeOrmCollectorModule, TYPEORM_COLLECTOR_OPTIONS } from './typeorm-collector.module';
import { TypeOrmCollector } from './typeorm.collector';
import { TypeOrmDriverPatch } from './typeorm-driver.patch';

function optionsProvider(mod: DynamicModule): Provider | undefined {
  return (mod.providers ?? []).find(
    (p): p is Provider =>
      typeof p === 'object' &&
      p !== null &&
      'provide' in p &&
      p.provide === TYPEORM_COLLECTOR_OPTIONS,
  );
}

describe('TypeOrmCollectorModule.forRoot', () => {
  it('registers the driver patch, collector and the options token (useValue)', () => {
    const mod = TypeOrmCollectorModule.forRoot({ slowQueryThreshold: 50 });
    expect(mod.module).toBe(TypeOrmCollectorModule);
    expect(mod.providers).toEqual(expect.arrayContaining([TypeOrmDriverPatch, TypeOrmCollector]));
    expect((optionsProvider(mod) as ValueProvider).useValue).toEqual({ slowQueryThreshold: 50 });
  });

  it('returns an inert module when enabled is false', () => {
    const mod = TypeOrmCollectorModule.forRoot({ enabled: false });
    expect(mod.module).toBe(TypeOrmCollectorModule);
    expect(mod.providers ?? []).not.toContain(TypeOrmCollector);
  });
});

describe('TypeOrmCollectorModule.forRootAsync', () => {
  it('provides the options token from the factory and forwards imports/inject', () => {
    class FakeImport {}
    const useFactory = (): { slowQueryThreshold: number } => ({ slowQueryThreshold: 25 });
    const mod = TypeOrmCollectorModule.forRootAsync({
      imports: [FakeImport],
      inject: ['CONFIG'],
      useFactory,
    });
    expect(mod.imports).toContain(FakeImport);
    expect(mod.providers).toEqual(expect.arrayContaining([TypeOrmDriverPatch, TypeOrmCollector]));
    const opts = optionsProvider(mod) as FactoryProvider;
    expect(opts.useFactory).toBe(useFactory);
    expect(opts.inject).toEqual(['CONFIG']);
  });

  it('returns an inert module when enabled is false', () => {
    const mod = TypeOrmCollectorModule.forRootAsync({ enabled: false, useFactory: () => ({}) });
    expect(mod.providers ?? []).not.toContain(TypeOrmCollector);
  });
});
