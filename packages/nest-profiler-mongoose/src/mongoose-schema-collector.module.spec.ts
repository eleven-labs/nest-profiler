import type { DynamicModule, FactoryProvider, Provider, ValueProvider } from '@nestjs/common';
import {
  MongooseSchemaCollectorModule,
  MONGOOSE_SCHEMA_COLLECTOR_OPTIONS,
} from './mongoose-schema-collector.module';
import { MongooseSchemaCollector } from './mongoose-schema.collector';

function optionsProvider(mod: DynamicModule): Provider | undefined {
  return (mod.providers ?? []).find(
    (p): p is Provider =>
      typeof p === 'object' &&
      p !== null &&
      'provide' in p &&
      p.provide === MONGOOSE_SCHEMA_COLLECTOR_OPTIONS,
  );
}

describe('MongooseSchemaCollectorModule.forRoot', () => {
  it('registers the collector and the options token (useValue)', () => {
    const mod = MongooseSchemaCollectorModule.forRoot({ connectionName: 'analytics' });
    expect(mod.module).toBe(MongooseSchemaCollectorModule);
    expect(mod.providers).toEqual(expect.arrayContaining([MongooseSchemaCollector]));
    expect((optionsProvider(mod) as ValueProvider).useValue).toEqual({
      connectionName: 'analytics',
    });
  });

  it('returns an inert module when enabled is false', () => {
    const mod = MongooseSchemaCollectorModule.forRoot({ enabled: false });
    expect(mod.providers ?? []).not.toContain(MongooseSchemaCollector);
  });
});

describe('MongooseSchemaCollectorModule.forRootAsync', () => {
  it('provides the options token from the factory and forwards imports/inject', () => {
    class FakeImport {}
    const useFactory = (): { connectionName: string } => ({ connectionName: 'analytics' });
    const mod = MongooseSchemaCollectorModule.forRootAsync({
      imports: [FakeImport],
      inject: ['CONFIG'],
      useFactory,
    });
    expect(mod.imports).toContain(FakeImport);
    expect(mod.providers).toEqual(expect.arrayContaining([MongooseSchemaCollector]));
    const opts = optionsProvider(mod) as FactoryProvider;
    expect(opts.useFactory).toBe(useFactory);
    expect(opts.inject).toEqual(['CONFIG']);
  });

  it('returns an inert module when enabled is false', () => {
    const mod = MongooseSchemaCollectorModule.forRootAsync({
      enabled: false,
      useFactory: () => ({}),
    });
    expect(mod.providers ?? []).not.toContain(MongooseSchemaCollector);
  });
});
