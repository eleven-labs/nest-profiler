import type { DynamicModule, FactoryProvider } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { HttpCollectorModule } from './http-collector.module';
import type { HttpInstrumentation } from './http-instrumentation.interface';
import type { HttpProfilerRecorder } from './http-profiler-recorder.service';
import { HttpClientCollector } from './http-client.collector';
import { HttpProfilerRecorder as Recorder } from './http-profiler-recorder.service';
import { HttpInstrumentationRunner } from './http-instrumentation.runner';
import { HTTP_COLLECTOR_OPTIONS, HTTP_INSTRUMENTATIONS } from './http-collector.constants';

class FakeInstrumentation implements HttpInstrumentation {
  install(_recorder: HttpProfilerRecorder): void {}
}

class OtherInstrumentation implements HttpInstrumentation {
  install(_recorder: HttpProfilerRecorder): void {}
}

function instrumentationsProvider(mod: DynamicModule): FactoryProvider {
  const found = (mod.providers ?? []).find(
    (p): p is FactoryProvider =>
      typeof p === 'object' && 'provide' in p && p.provide === HTTP_INSTRUMENTATIONS,
  );
  if (!found) throw new Error('HTTP_INSTRUMENTATIONS provider not found');
  return found;
}

describe('HttpCollectorModule.forRoot', () => {
  it('still exports an (injectable, no-op) recorder when enabled is false', () => {
    // MAJ-15: the recorder is part of the public API (consumers inject it), so it must stay
    // resolvable even when disabled — otherwise toggling the profiler off crashes their DI.
    const mod = HttpCollectorModule.forRoot({ enabled: false });
    expect(mod.module).toBe(HttpCollectorModule);
    expect(mod.providers).toEqual(expect.arrayContaining([Recorder]));
    expect(mod.exports).toContain(Recorder);
    // No instrumentation runner/collector is registered in the disabled path.
    expect(mod.providers).not.toContain(HttpInstrumentationRunner);
    expect(mod.providers).not.toContain(HttpClientCollector);
  });

  it('registers the collector, recorder and runner, and exports the recorder', () => {
    const mod = HttpCollectorModule.forRoot();
    expect(mod.providers).toEqual(
      expect.arrayContaining([HttpClientCollector, Recorder, HttpInstrumentationRunner]),
    );
    expect(mod.exports).toContain(Recorder);
  });

  it('imports DiscoveryModule on the active path (powers axios auto-discovery)', () => {
    const mod = HttpCollectorModule.forRoot();
    expect(mod.imports).toContain(DiscoveryModule);
  });

  it('instruments nothing by default (no adapter is default-on)', () => {
    const mod = HttpCollectorModule.forRoot();
    expect(instrumentationsProvider(mod).inject).toEqual([]);
  });

  it('registers and wires exactly the selected instrumentations, in order', () => {
    const mod = HttpCollectorModule.forRoot({
      instrumentations: [FakeInstrumentation, OtherInstrumentation],
    });
    expect(mod.providers).toEqual(
      expect.arrayContaining([FakeInstrumentation, OtherInstrumentation]),
    );
    expect(instrumentationsProvider(mod).inject).toEqual([
      FakeInstrumentation,
      OtherInstrumentation,
    ]);
  });

  it('collects the resolved instrumentation instances via its factory', () => {
    const provider = instrumentationsProvider(
      HttpCollectorModule.forRoot({ instrumentations: [FakeInstrumentation] }),
    );
    const instance = new FakeInstrumentation();
    expect(provider.useFactory(instance)).toEqual([instance]);
  });
});

describe('HttpCollectorModule.forRootAsync', () => {
  function optionsProvider(mod: DynamicModule): FactoryProvider {
    const found = (mod.providers ?? []).find(
      (p): p is FactoryProvider =>
        typeof p === 'object' &&
        'provide' in p &&
        p.provide === HTTP_COLLECTOR_OPTIONS &&
        'useFactory' in p,
    );
    if (!found) throw new Error('options factory provider not found');
    return found;
  }

  it('provides HTTP_COLLECTOR_OPTIONS from the factory, forwards imports, and wires instrumentations', () => {
    class FakeImport {}
    const useFactory = (): { captureResponseBody: boolean } => ({ captureResponseBody: true });
    const mod = HttpCollectorModule.forRootAsync({
      imports: [FakeImport],
      inject: ['SOME_TOKEN'],
      useFactory,
      instrumentations: [FakeInstrumentation],
    });

    expect(mod.imports).toEqual(expect.arrayContaining([FakeImport, DiscoveryModule]));
    expect(mod.providers).toEqual(
      expect.arrayContaining([FakeInstrumentation, Recorder, HttpInstrumentationRunner]),
    );
    expect(mod.exports).toContain(Recorder);
    // The options come from the async factory (not a useValue).
    const opts = optionsProvider(mod);
    expect(opts.inject).toEqual(['SOME_TOKEN']);
    expect(opts.useFactory).toBe(useFactory);
  });

  it('still exports an (injectable, no-op) recorder when enabled is false', () => {
    const mod = HttpCollectorModule.forRootAsync({
      enabled: false,
      useFactory: () => ({}),
    });
    expect(mod.providers).toEqual(expect.arrayContaining([Recorder]));
    expect(mod.exports).toContain(Recorder);
    expect(mod.providers).not.toContain(HttpInstrumentationRunner);
  });
});
