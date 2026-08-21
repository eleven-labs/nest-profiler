import type { DynamicModule, FactoryProvider, Provider, ValueProvider } from '@nestjs/common';
import {
  RabbitMqPublishCollectorModule,
  RABBITMQ_PUBLISH_COLLECTOR_OPTIONS,
} from './rabbitmq-publish-collector.module';
import { RabbitMqPublishCollector } from './rabbitmq-publish.collector';
import { RabbitMqPublishPatch } from './rabbitmq-publish.patch';

function optionsProvider(mod: DynamicModule): Provider | undefined {
  return (mod.providers ?? []).find(
    (p): p is Provider =>
      typeof p === 'object' &&
      p !== null &&
      'provide' in p &&
      p.provide === RABBITMQ_PUBLISH_COLLECTOR_OPTIONS,
  );
}

describe('RabbitMqPublishCollectorModule.forRoot', () => {
  it('registers the publish patch, the collector and the options token (useValue)', () => {
    const mod = RabbitMqPublishCollectorModule.forRoot({ slowThreshold: 20 });
    expect(mod.module).toBe(RabbitMqPublishCollectorModule);
    expect(mod.providers).toEqual(
      expect.arrayContaining([RabbitMqPublishPatch, RabbitMqPublishCollector]),
    );
    expect((optionsProvider(mod) as ValueProvider).useValue).toEqual({ slowThreshold: 20 });
  });

  it('returns an inert module when enabled is false', () => {
    const mod = RabbitMqPublishCollectorModule.forRoot({ enabled: false });
    expect(mod.module).toBe(RabbitMqPublishCollectorModule);
    expect(mod.providers ?? []).not.toContain(RabbitMqPublishCollector);
    expect(mod.providers ?? []).not.toContain(RabbitMqPublishPatch);
  });
});

describe('RabbitMqPublishPatch options injection', () => {
  /**
   * Guards the import-cycle regression the mongoose patch hit: importing the options token from
   * the module (which imports the patch back) leaves it undefined when the decorators run, so
   * `@Inject(undefined)` falls through to the `@Optional()` default and every option is
   * silently ignored.
   */
  it('decorates the options parameter with the resolved token', () => {
    const injected = Reflect.getMetadata('self:paramtypes', RabbitMqPublishPatch) as {
      index: number;
      param?: unknown;
    }[];
    expect(injected).toEqual([{ index: 1, param: RABBITMQ_PUBLISH_COLLECTOR_OPTIONS }]);
  });
});

describe('RabbitMqPublishCollectorModule.forRootAsync', () => {
  it('provides the options token from the factory and forwards imports/inject', () => {
    class FakeImport {}
    const useFactory = (): { slowThreshold: number } => ({ slowThreshold: 25 });
    const mod = RabbitMqPublishCollectorModule.forRootAsync({
      imports: [FakeImport],
      inject: ['CONFIG'],
      useFactory,
    });
    expect(mod.imports).toContain(FakeImport);
    expect(mod.providers).toEqual(
      expect.arrayContaining([RabbitMqPublishPatch, RabbitMqPublishCollector]),
    );
    const opts = optionsProvider(mod) as FactoryProvider;
    expect(opts.useFactory).toBe(useFactory);
    expect(opts.inject).toEqual(['CONFIG']);
  });

  it('returns an inert module when enabled is false', () => {
    const mod = RabbitMqPublishCollectorModule.forRootAsync({
      enabled: false,
      useFactory: () => ({}),
    });
    expect(mod.providers ?? []).not.toContain(RabbitMqPublishCollector);
  });
});
