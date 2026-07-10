import type { DynamicModule, FactoryProvider, Provider, ValueProvider } from '@nestjs/common';
import {
  TypeOrmSchemaCollectorModule,
  TYPEORM_SCHEMA_COLLECTOR_OPTIONS,
} from './typeorm-schema-collector.module';
import { TypeOrmSchemaCollector } from './typeorm-schema.collector';

function optionsProvider(mod: DynamicModule): Provider | undefined {
  return (mod.providers ?? []).find(
    (p): p is Provider =>
      typeof p === 'object' &&
      p !== null &&
      'provide' in p &&
      p.provide === TYPEORM_SCHEMA_COLLECTOR_OPTIONS,
  );
}

describe('TypeOrmSchemaCollectorModule.forRoot', () => {
  it('registers the collector and the options token (useValue)', () => {
    const mod = TypeOrmSchemaCollectorModule.forRoot({ connectionName: 'analytics' });
    expect(mod.module).toBe(TypeOrmSchemaCollectorModule);
    expect(mod.providers).toEqual(expect.arrayContaining([TypeOrmSchemaCollector]));
    expect((optionsProvider(mod) as ValueProvider).useValue).toEqual({
      connectionName: 'analytics',
    });
  });

  it('returns an inert module when enabled is false', () => {
    const mod = TypeOrmSchemaCollectorModule.forRoot({ enabled: false });
    expect(mod.providers ?? []).not.toContain(TypeOrmSchemaCollector);
  });
});

describe('TypeOrmSchemaCollectorModule.forRootAsync', () => {
  it('provides the options token from the factory and forwards imports/inject', () => {
    class FakeImport {}
    const useFactory = (): { connectionName: string } => ({ connectionName: 'analytics' });
    const mod = TypeOrmSchemaCollectorModule.forRootAsync({
      imports: [FakeImport],
      inject: ['CONFIG'],
      useFactory,
    });
    expect(mod.imports).toContain(FakeImport);
    expect(mod.providers).toEqual(expect.arrayContaining([TypeOrmSchemaCollector]));
    const opts = optionsProvider(mod) as FactoryProvider;
    expect(opts.useFactory).toBe(useFactory);
    expect(opts.inject).toEqual(['CONFIG']);
  });

  it('returns an inert module when enabled is false', () => {
    const mod = TypeOrmSchemaCollectorModule.forRootAsync({
      enabled: false,
      useFactory: () => ({}),
    });
    expect(mod.providers ?? []).not.toContain(TypeOrmSchemaCollector);
  });
});
