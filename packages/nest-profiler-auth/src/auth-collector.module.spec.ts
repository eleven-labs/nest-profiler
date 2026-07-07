import type { DynamicModule, FactoryProvider, Provider, ValueProvider } from '@nestjs/common';
import { AuthCollectorModule, AUTH_COLLECTOR_OPTIONS } from './auth-collector.module';
import { AuthCollector } from './auth.collector';

function optionsProvider(mod: DynamicModule): Provider | undefined {
  return (mod.providers ?? []).find(
    (p): p is Provider =>
      typeof p === 'object' && p !== null && 'provide' in p && p.provide === AUTH_COLLECTOR_OPTIONS,
  );
}

describe('AuthCollectorModule.forRoot', () => {
  it('registers the collector and the options token (useValue)', () => {
    const mod = AuthCollectorModule.forRoot({ maskUserFields: ['password'] });
    expect(mod.module).toBe(AuthCollectorModule);
    expect(mod.providers).toEqual(expect.arrayContaining([AuthCollector]));
    expect((optionsProvider(mod) as ValueProvider).useValue).toEqual({
      maskUserFields: ['password'],
    });
  });

  it('returns an inert module when enabled is false', () => {
    const mod = AuthCollectorModule.forRoot({ enabled: false });
    expect(mod.module).toBe(AuthCollectorModule);
    expect(mod.providers ?? []).not.toContain(AuthCollector);
  });
});

describe('AuthCollectorModule.forRootAsync', () => {
  it('provides the options token from the factory and forwards imports/inject', () => {
    class FakeImport {}
    const useFactory = (): { maskUserFields: string[] } => ({ maskUserFields: ['refreshToken'] });
    const mod = AuthCollectorModule.forRootAsync({
      imports: [FakeImport],
      inject: ['CONFIG'],
      useFactory,
    });
    expect(mod.imports).toContain(FakeImport);
    expect(mod.providers).toEqual(expect.arrayContaining([AuthCollector]));
    const opts = optionsProvider(mod) as FactoryProvider;
    expect(opts.useFactory).toBe(useFactory);
    expect(opts.inject).toEqual(['CONFIG']);
  });

  it('returns an inert module when enabled is false', () => {
    const mod = AuthCollectorModule.forRootAsync({ enabled: false, useFactory: () => ({}) });
    expect(mod.providers ?? []).not.toContain(AuthCollector);
  });
});
