import type { DynamicModule, FactoryProvider, Provider, ValueProvider } from '@nestjs/common';
import { ConfigCollectorModule, CONFIG_COLLECTOR_OPTIONS } from './config-collector.module';
import { ConfigCollector } from './config.collector';

function optionsProvider(mod: DynamicModule): Provider | undefined {
  return (mod.providers ?? []).find(
    (p): p is Provider =>
      typeof p === 'object' &&
      p !== null &&
      'provide' in p &&
      p.provide === CONFIG_COLLECTOR_OPTIONS,
  );
}

describe('ConfigCollectorModule.forRoot', () => {
  it('registers the collector and the options token (useValue)', () => {
    const mod = ConfigCollectorModule.forRoot({ maskKeys: ['SECRET'] });
    expect(mod.module).toBe(ConfigCollectorModule);
    expect(mod.providers).toEqual(expect.arrayContaining([ConfigCollector]));
    expect((optionsProvider(mod) as ValueProvider).useValue).toEqual({ maskKeys: ['SECRET'] });
  });

  it('returns an inert module when enabled is false', () => {
    const mod = ConfigCollectorModule.forRoot({ enabled: false });
    expect(mod.module).toBe(ConfigCollectorModule);
    expect(mod.providers ?? []).not.toContain(ConfigCollector);
  });
});

describe('ConfigCollectorModule.forRootAsync', () => {
  it('provides the options token from the factory and forwards imports/inject', () => {
    class FakeImport {}
    const useFactory = (): { maskKeys: string[] } => ({ maskKeys: ['TOKEN'] });
    const mod = ConfigCollectorModule.forRootAsync({
      imports: [FakeImport],
      inject: ['CONFIG'],
      useFactory,
    });
    expect(mod.imports).toContain(FakeImport);
    expect(mod.providers).toEqual(expect.arrayContaining([ConfigCollector]));
    const opts = optionsProvider(mod) as FactoryProvider;
    expect(opts.useFactory).toBe(useFactory);
    expect(opts.inject).toEqual(['CONFIG']);
  });

  it('returns an inert module when enabled is false', () => {
    const mod = ConfigCollectorModule.forRootAsync({ enabled: false, useFactory: () => ({}) });
    expect(mod.providers ?? []).not.toContain(ConfigCollector);
  });
});
