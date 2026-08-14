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
    const mod = MongooseCollectorModule.forRoot({ slowThreshold: 50 });
    expect(mod.module).toBe(MongooseCollectorModule);
    expect(mod.providers).toEqual(
      expect.arrayContaining([MongooseConnectionPatch, MongooseCollector]),
    );
    expect((optionsProvider(mod) as ValueProvider).useValue).toEqual({ slowThreshold: 50 });
  });

  it('returns an inert module when enabled is false', () => {
    const mod = MongooseCollectorModule.forRoot({ enabled: false });
    expect(mod.module).toBe(MongooseCollectorModule);
    expect(mod.providers ?? []).not.toContain(MongooseCollector);
  });
});

describe('MongooseConnectionPatch options injection', () => {
  /**
   * Guards the import cycle regression: the patch used to import the options token from
   * `./mongoose-collector.module`, which imports the patch back — the token was still
   * undefined when the decorators ran, so `@Inject(undefined)` fell through to the
   * `@Optional()` default and every option was silently ignored.
   */
  it('decorates the options parameter with the resolved token', () => {
    const injected = Reflect.getMetadata('self:paramtypes', MongooseConnectionPatch) as {
      index: number;
      param?: unknown;
    }[];
    expect(injected).toEqual([{ index: 1, param: MONGOOSE_COLLECTOR_OPTIONS }]);
  });
});

describe('MongooseCollectorModule.forRootAsync', () => {
  it('provides the options token from the factory and forwards imports/inject', () => {
    class FakeImport {}
    const useFactory = (): { slowThreshold: number } => ({ slowThreshold: 25 });
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
