import type { DynamicModule, FactoryProvider } from '@nestjs/common';
import { HttpCollectorModule } from './http-collector.module';
import type { HttpInstrumentation } from './http-instrumentation.interface';
import type { HttpProfilerRecorder } from './http-profiler-recorder.service';
import { AxiosInstrumentation } from './adapters/axios.instrumentation';
import { HttpClientCollector } from './http-client.collector';
import { HttpProfilerRecorder as Recorder } from './http-profiler-recorder.service';
import { HttpInstrumentationRunner } from './http-instrumentation.runner';
import { HTTP_INSTRUMENTATIONS } from './http-collector.constants';

class FakeInstrumentation implements HttpInstrumentation {
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
  it('returns a no-op module when enabled is false', () => {
    expect(HttpCollectorModule.forRoot({ enabled: false })).toEqual({
      module: HttpCollectorModule,
    });
  });

  it('registers the collector, recorder and runner, and exports the recorder', () => {
    const mod = HttpCollectorModule.forRoot();
    expect(mod.providers).toEqual(
      expect.arrayContaining([HttpClientCollector, Recorder, HttpInstrumentationRunner]),
    );
    expect(mod.exports).toContain(Recorder);
  });

  it('enables the axios instrumentation by default', () => {
    const mod = HttpCollectorModule.forRoot();
    expect(mod.providers).toContain(AxiosInstrumentation);
    expect(instrumentationsProvider(mod).inject).toEqual([AxiosInstrumentation]);
  });

  it('omits the axios instrumentation when axios is false', () => {
    const mod = HttpCollectorModule.forRoot({ axios: false });
    expect(mod.providers).not.toContain(AxiosInstrumentation);
    expect(instrumentationsProvider(mod).inject).toEqual([]);
  });

  it('appends custom instrumentations after the built-ins', () => {
    const mod = HttpCollectorModule.forRoot({ instrumentations: [FakeInstrumentation] });
    expect(instrumentationsProvider(mod).inject).toEqual([
      AxiosInstrumentation,
      FakeInstrumentation,
    ]);
  });

  it('collects the resolved instrumentation instances via its factory', () => {
    const provider = instrumentationsProvider(HttpCollectorModule.forRoot());
    const a = new AxiosInstrumentation({} as never);
    expect(provider.useFactory(a)).toEqual([a]);
  });
});
