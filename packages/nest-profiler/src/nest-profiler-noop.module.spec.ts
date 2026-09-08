import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ProfilerNoopModule } from './nest-profiler-noop.module';
import { TracerService } from './services/tracer.service';

import { ProfilerStorageService } from './services/profiler-storage.service';
import { CollectorRegistry } from './collectors/collector-registry.service';

describe('ProfilerNoopModule', () => {
  it('forRoot() resolves TracerService with none of its optional dependencies', async () => {
    const module = await Test.createTestingModule({
      imports: [ProfilerNoopModule.forRoot()],
    }).compile();
    // TracerService stays injectable everywhere so consumers never fail to resolve it. There is
    // no second no-op class behind it: both its dependencies are `@Optional()`, so the very same
    // class resolves here with nothing injected — and no ClsModule is pulled in.
    const profiler = module.get(TracerService);
    expect(profiler).toBeInstanceOf(TracerService);
    // …and none of the active layer is present.
    expect(() => module.get(CollectorRegistry)).toThrow();
    expect(() => module.get(ProfilerStorageService)).toThrow();
    await module.close();
  });

  it('every TracerService method is a safe no-op', async () => {
    const module = await Test.createTestingModule({
      imports: [ProfilerNoopModule.forRoot()],
    }).compile();
    const tracer = module.get<TracerService>(TracerService);
    expect(tracer.currentToken()).toBeUndefined();
    expect(tracer.currentTraceId()).toBeUndefined();
    expect(tracer.getAttribute('anything')).toBeUndefined();
    await expect(tracer.flush()).resolves.toBeUndefined();

    // The callback still runs and its value still comes back: a method wrapped in a span must
    // behave identically whether the profiler is plugged in or not.
    expect(tracer.span('phase', () => 42)).toBe(42);
    await expect(tracer.span('async', () => Promise.resolve('ok'))).resolves.toBe('ok');
    expect(() => tracer.startSpan('phase').setTag('k', 1).end()).not.toThrow();
    expect(() => tracer.activeSpan().addTags({ k: 1 })).not.toThrow();
    expect(() => tracer.captureError(new Error('boom'))).not.toThrow();
    expect(() => tracer.setAttribute('tenant', 'acme')).not.toThrow();
    await module.close();
  });

  it('registers no controller', () => {
    const mod = ProfilerNoopModule.forRoot();
    expect(mod.controllers ?? []).toHaveLength(0);
  });

  it('forRoot({ isGlobal: true }) sets global: true on the DynamicModule', () => {
    expect(ProfilerNoopModule.forRoot({ isGlobal: true }).global).toBe(true);
  });

  it('forRoot() defaults to global: false', () => {
    expect(ProfilerNoopModule.forRoot().global).toBe(false);
  });
});
