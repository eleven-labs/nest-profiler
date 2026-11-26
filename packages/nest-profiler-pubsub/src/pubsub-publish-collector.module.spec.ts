import type { DynamicModule, FactoryProvider, Provider, ValueProvider } from '@nestjs/common';
import {
  PubSubPublishCollectorModule,
  PUBSUB_PUBLISH_COLLECTOR_OPTIONS,
} from './pubsub-publish-collector.module.js';
import { PubSubPublishCollector } from './pubsub-publish.collector.js';
import { PubSubPublishPatch } from './pubsub-publish.patch.js';

function optionsProvider(mod: DynamicModule): Provider | undefined {
  return (mod.providers ?? []).find(
    (p): p is Provider =>
      typeof p === 'object' &&
      p !== null &&
      'provide' in p &&
      p.provide === PUBSUB_PUBLISH_COLLECTOR_OPTIONS,
  );
}

describe('PubSubPublishCollectorModule.forRoot', () => {
  it('registers the publish patch, the collector and the options token (useValue)', () => {
    const mod = PubSubPublishCollectorModule.forRoot({ slowThreshold: 20 });
    expect(mod.module).toBe(PubSubPublishCollectorModule);
    expect(mod.providers).toEqual(
      expect.arrayContaining([PubSubPublishPatch, PubSubPublishCollector]),
    );
    expect((optionsProvider(mod) as ValueProvider).useValue).toEqual({ slowThreshold: 20 });
  });

  it('returns an inert module when enabled is false', () => {
    const mod = PubSubPublishCollectorModule.forRoot({ enabled: false });
    expect(mod.module).toBe(PubSubPublishCollectorModule);
    expect(mod.providers ?? []).not.toContain(PubSubPublishCollector);
    expect(mod.providers ?? []).not.toContain(PubSubPublishPatch);
  });
});

describe('PubSubPublishPatch options injection', () => {
  /**
   * Guards the import-cycle regression the mongoose patch hit: importing the options token from
   * the module (which imports the patch back) leaves it undefined when the decorators run, so
   * `@Inject(undefined)` falls through to the `@Optional()` default and every option is
   * silently ignored.
   */
  it('decorates the options parameter with the resolved token', () => {
    const injected = Reflect.getMetadata('self:paramtypes', PubSubPublishPatch) as {
      index: number;
      param?: unknown;
    }[];
    expect(injected).toEqual([{ index: 1, param: PUBSUB_PUBLISH_COLLECTOR_OPTIONS }]);
  });
});

describe('PubSubPublishCollectorModule.forRootAsync', () => {
  it('provides the options token from the factory and forwards imports/inject', () => {
    class FakeImport {}
    const useFactory = (): { slowThreshold: number } => ({ slowThreshold: 25 });
    const mod = PubSubPublishCollectorModule.forRootAsync({
      imports: [FakeImport],
      inject: ['CONFIG'],
      useFactory,
    });
    expect(mod.imports).toContain(FakeImport);
    expect(mod.providers).toEqual(
      expect.arrayContaining([PubSubPublishPatch, PubSubPublishCollector]),
    );
    const opts = optionsProvider(mod) as FactoryProvider;
    expect(opts.useFactory).toBe(useFactory);
    expect(opts.inject).toEqual(['CONFIG']);
  });

  it('returns an inert module when enabled is false', () => {
    const mod = PubSubPublishCollectorModule.forRootAsync({
      enabled: false,
      useFactory: () => ({}),
    });
    expect(mod.providers ?? []).not.toContain(PubSubPublishCollector);
  });
});
