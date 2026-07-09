import type { DynamicModule, FactoryProvider, Provider, ValueProvider } from '@nestjs/common';
import { RoutesCollectorModule, ROUTES_COLLECTOR_OPTIONS } from './routes-collector.module';
import { RoutesCollector } from './routes.collector';
import { HttpRouteSource } from './http-route-source';

function optionsProvider(mod: DynamicModule): Provider | undefined {
  return (mod.providers ?? []).find(
    (p): p is Provider =>
      typeof p === 'object' &&
      p !== null &&
      'provide' in p &&
      p.provide === ROUTES_COLLECTOR_OPTIONS,
  );
}

describe('RoutesCollectorModule.forRoot', () => {
  it('registers the collector, the HTTP source and the options token (useValue)', () => {
    const mod = RoutesCollectorModule.forRoot();
    expect(mod.module).toBe(RoutesCollectorModule);
    expect(mod.providers).toEqual(expect.arrayContaining([RoutesCollector, HttpRouteSource]));
    expect((optionsProvider(mod) as ValueProvider).useValue).toEqual({});
  });

  it('returns an inert module when enabled is false', () => {
    const mod = RoutesCollectorModule.forRoot({ enabled: false });
    expect(mod.module).toBe(RoutesCollectorModule);
    expect(mod.providers ?? []).not.toContain(RoutesCollector);
    expect(mod.providers ?? []).not.toContain(HttpRouteSource);
  });
});

describe('RoutesCollectorModule.forRootAsync', () => {
  it('provides the options token from the factory and forwards imports/inject', () => {
    class FakeImport {}
    const useFactory = (): { enabled: boolean } => ({ enabled: true });
    const mod = RoutesCollectorModule.forRootAsync({
      imports: [FakeImport],
      inject: ['CONFIG'],
      useFactory,
    });
    expect(mod.imports).toContain(FakeImport);
    expect(mod.providers).toEqual(expect.arrayContaining([RoutesCollector, HttpRouteSource]));
    const opts = optionsProvider(mod) as FactoryProvider;
    expect(opts.useFactory).toBe(useFactory);
    expect(opts.inject).toEqual(['CONFIG']);
  });

  it('returns an inert module when enabled is false', () => {
    const mod = RoutesCollectorModule.forRootAsync({ enabled: false, useFactory: () => ({}) });
    expect(mod.providers ?? []).not.toContain(RoutesCollector);
  });
});
