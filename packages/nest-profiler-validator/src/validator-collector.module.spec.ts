import type { DynamicModule, FactoryProvider, Provider, ValueProvider } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import {
  ValidatorCollectorModule,
  VALIDATOR_COLLECTOR_OPTIONS,
} from './validator-collector.module';
import { ValidatorCollector } from './validator.collector';

function optionsProvider(mod: DynamicModule): Provider | undefined {
  return (mod.providers ?? []).find(
    (p): p is Provider =>
      typeof p === 'object' &&
      p !== null &&
      'provide' in p &&
      p.provide === VALIDATOR_COLLECTOR_OPTIONS,
  );
}

describe('ValidatorCollectorModule.forRoot', () => {
  it('registers only the collector panel and the options token (useValue)', () => {
    const mod = ValidatorCollectorModule.forRoot();
    expect(mod.module).toBe(ValidatorCollectorModule);
    expect(mod.providers).toContain(ValidatorCollector);
    expect((optionsProvider(mod) as ValueProvider).useValue).toEqual({});
  });

  it('returns an inert module when enabled is false', () => {
    const mod = ValidatorCollectorModule.forRoot({ enabled: false });
    expect(mod.module).toBe(ValidatorCollectorModule);
    expect(mod.providers ?? []).not.toContain(ValidatorCollector);
  });

  it('wires the collector through the DI container', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ClsModule.forRoot({ global: true, middleware: { mount: false } }),
        ValidatorCollectorModule.forRoot(),
      ],
    }).compile();
    expect(moduleRef.get(ValidatorCollector, { strict: false })).toBeInstanceOf(ValidatorCollector);
  });
});

describe('ValidatorCollectorModule.forRootAsync', () => {
  it('provides the options token from the factory and forwards imports/inject', () => {
    class FakeImport {}
    const useFactory = (): { enabled: boolean } => ({ enabled: true });
    const mod = ValidatorCollectorModule.forRootAsync({
      imports: [FakeImport],
      inject: ['CONFIG'],
      useFactory,
    });
    expect(mod.imports).toContain(FakeImport);
    expect(mod.providers).toContain(ValidatorCollector);
    const opts = optionsProvider(mod) as FactoryProvider;
    expect(opts.useFactory).toBe(useFactory);
    expect(opts.inject).toEqual(['CONFIG']);
  });

  it('returns an inert module when enabled is false', () => {
    const mod = ValidatorCollectorModule.forRootAsync({ enabled: false, useFactory: () => ({}) });
    expect(mod.providers ?? []).not.toContain(ValidatorCollector);
  });
});
