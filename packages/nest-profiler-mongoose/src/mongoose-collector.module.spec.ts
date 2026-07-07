import type { DynamicModule, FactoryProvider, Provider, ValueProvider } from '@nestjs/common';
import { MongooseCollectorModule, MONGOOSE_COLLECTOR_OPTIONS } from './mongoose-collector.module';
import { MongooseCollector } from './mongoose.collector';
import { MongooseConnectionPatch } from './mongoose-connection.patch';

function optionsProvider(mod: DynamicModule): Provider | undefined {
  return (mod.providers ?? []).find(
    (p): p is Provider =>
      typeof p === 'object' &&
      p !== null &&
      'provide' in p &&
      p.provide === MONGOOSE_COLLECTOR_OPTIONS,
  );
}

describe('MongooseCollectorModule.forRoot', () => {
  it('registers the connection patch, collector and the options token (useValue)', () => {
    const mod = MongooseCollectorModule.forRoot({ slowQueryThreshold: 50 });
    expect(mod.module).toBe(MongooseCollectorModule);
    expect(mod.providers).toEqual(
      expect.arrayContaining([MongooseConnectionPatch, MongooseCollector]),
    );
    expect((optionsProvider(mod) as ValueProvider).useValue).toEqual({ slowQueryThreshold: 50 });
  });

  it('returns an inert module when enabled is false', () => {
    const mod = MongooseCollectorModule.forRoot({ enabled: false });
    expect(mod.module).toBe(MongooseCollectorModule);
    expect(mod.providers ?? []).not.toContain(MongooseCollector);
  });
});

describe('MongooseCollectorModule.forRootAsync', () => {
  it('provides the options token from the factory and forwards imports/inject', () => {
    class FakeImport {}
    const useFactory = (): { slowQueryThreshold: number } => ({ slowQueryThreshold: 25 });
    const mod = MongooseCollectorModule.forRootAsync({
      imports: [FakeImport],
      inject: ['CONFIG'],
      useFactory,
    });
    expect(mod.imports).toContain(FakeImport);
    expect(mod.providers).toEqual(
      expect.arrayContaining([MongooseConnectionPatch, MongooseCollector]),
    );
    const opts = optionsProvider(mod) as FactoryProvider;
    expect(opts.useFactory).toBe(useFactory);
    expect(opts.inject).toEqual(['CONFIG']);
  });

  it('returns an inert module when enabled is false', () => {
    const mod = MongooseCollectorModule.forRootAsync({ enabled: false, useFactory: () => ({}) });
    expect(mod.providers ?? []).not.toContain(MongooseCollector);
  });
});
