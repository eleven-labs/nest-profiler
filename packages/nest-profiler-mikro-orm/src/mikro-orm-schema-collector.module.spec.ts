import type { DynamicModule, FactoryProvider, Provider, ValueProvider } from '@nestjs/common';

// MikroORM v7 (and @mikro-orm/nestjs) are ESM-only; the collector imports `MikroORM` and
// `ReferenceKind`. Stub both so the CommonJS jest runtime never parses the real ESM entries.
jest.mock('@mikro-orm/core', () => ({
  MikroORM: class MikroORM {},
  ReferenceKind: {
    SCALAR: 'scalar',
    ONE_TO_ONE: '1:1',
    ONE_TO_MANY: '1:m',
    MANY_TO_ONE: 'm:1',
    MANY_TO_MANY: 'm:n',
    EMBEDDED: 'embedded',
  },
}));
jest.mock('@mikro-orm/nestjs', () => ({ getMikroORMToken: (name: string) => `MikroORM_${name}` }));

import { MikroOrmSchemaCollectorModule } from './mikro-orm-schema-collector.module.js';
import { MIKRO_ORM_SCHEMA_COLLECTOR_OPTIONS } from './mikro-orm-schema-collector.interface.js';
import { MikroOrmSchemaCollector } from './mikro-orm-schema.collector.js';

function optionsProvider(mod: DynamicModule): Provider | undefined {
  return (mod.providers ?? []).find(
    (p): p is Provider =>
      typeof p === 'object' &&
      p !== null &&
      'provide' in p &&
      p.provide === MIKRO_ORM_SCHEMA_COLLECTOR_OPTIONS,
  );
}

describe('MikroOrmSchemaCollectorModule.forRoot', () => {
  it('registers the collector and the options token (useValue)', () => {
    const mod = MikroOrmSchemaCollectorModule.forRoot({ connectionName: 'analytics' });
    expect(mod.module).toBe(MikroOrmSchemaCollectorModule);
    expect(mod.providers).toEqual(expect.arrayContaining([MikroOrmSchemaCollector]));
    expect((optionsProvider(mod) as ValueProvider).useValue).toEqual({
      connectionName: 'analytics',
    });
  });

  it('returns an inert module when enabled is false', () => {
    const mod = MikroOrmSchemaCollectorModule.forRoot({ enabled: false });
    expect(mod.providers ?? []).not.toContain(MikroOrmSchemaCollector);
  });

  it('defaults options to an empty object when called with no arguments', () => {
    const mod = MikroOrmSchemaCollectorModule.forRoot();
    expect(mod.providers).toEqual(expect.arrayContaining([MikroOrmSchemaCollector]));
  });
});

describe('MikroOrmSchemaCollectorModule.forRootAsync', () => {
  it('provides the options token from the factory and forwards imports/inject', () => {
    class FakeImport {}
    const useFactory = (): { connectionName: string } => ({ connectionName: 'analytics' });
    const mod = MikroOrmSchemaCollectorModule.forRootAsync({
      imports: [FakeImport],
      inject: ['CONFIG'],
      useFactory,
    });
    expect(mod.imports).toContain(FakeImport);
    expect(mod.providers).toEqual(expect.arrayContaining([MikroOrmSchemaCollector]));
    const opts = optionsProvider(mod) as FactoryProvider;
    expect(opts.useFactory).toBe(useFactory);
    expect(opts.inject).toEqual(['CONFIG']);
  });

  it('returns an inert module when enabled is false', () => {
    const mod = MikroOrmSchemaCollectorModule.forRootAsync({
      enabled: false,
      useFactory: () => ({}),
    });
    expect(mod.providers ?? []).not.toContain(MikroOrmSchemaCollector);
  });
});
