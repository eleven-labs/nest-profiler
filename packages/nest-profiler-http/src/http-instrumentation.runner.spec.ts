import type { ClsService } from 'nestjs-cls';
import { HttpInstrumentationRunner } from './http-instrumentation.runner';
import { HttpProfilerRecorder } from './http-profiler-recorder.service';
import type { HttpInstrumentation } from './http-instrumentation.interface';

describe('HttpInstrumentationRunner', () => {
  it('installs every instrumentation with the shared recorder on bootstrap', async () => {
    const cls = { get: jest.fn() } as unknown as ClsService;
    const recorder = new HttpProfilerRecorder(cls, {});
    const installA = jest.fn();
    const installB = jest.fn();
    const instrumentations: HttpInstrumentation[] = [{ install: installA }, { install: installB }];

    await new HttpInstrumentationRunner(instrumentations, recorder).onApplicationBootstrap();

    expect(installA).toHaveBeenCalledWith(recorder);
    expect(installB).toHaveBeenCalledWith(recorder);
  });

  it('awaits async instrumentations and tolerates an empty list', async () => {
    const cls = { get: jest.fn() } as unknown as ClsService;
    const recorder = new HttpProfilerRecorder(cls, {});
    const installed: string[] = [];
    const asyncInstrumentation: HttpInstrumentation = {
      install: () =>
        Promise.resolve().then(() => {
          installed.push('done');
        }),
    };

    await new HttpInstrumentationRunner([asyncInstrumentation], recorder).onApplicationBootstrap();
    expect(installed).toEqual(['done']);

    await expect(
      new HttpInstrumentationRunner([], recorder).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
  });
});
