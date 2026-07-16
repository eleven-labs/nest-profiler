import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ProfilerNoopModule } from './nest-profiler-noop.module';
import { ProfilerService } from './services/nest-profiler.service';
import { NoopProfilerService } from './services/noop-profiler.service';
import { ProfilerStorageService } from './services/profiler-storage.service';
import { CollectorRegistry } from './collectors/collector-registry.service';

describe('ProfilerNoopModule', () => {
  it('forRoot() resolves ProfilerService to the no-op service', async () => {
    const module = await Test.createTestingModule({
      imports: [ProfilerNoopModule.forRoot()],
    }).compile();
    // ProfilerService stays injectable everywhere so consumers never fail to resolve it,
    // backed by the zero-dependency no-op service (no ClsModule pulled in)…
    const profiler = module.get(ProfilerService);
    expect(profiler).toBeInstanceOf(NoopProfilerService);
    // …and none of the active layer is present.
    expect(() => module.get(CollectorRegistry)).toThrow();
    expect(() => module.get(ProfilerStorageService)).toThrow();
    await module.close();
  });

  it('every ProfilerService method is a safe no-op', async () => {
    const module = await Test.createTestingModule({
      imports: [ProfilerNoopModule.forRoot()],
    }).compile();
    const profiler = module.get<ProfilerService>(ProfilerService);
    expect(profiler.getCurrentToken()).toBeUndefined();
    await expect(profiler.flush()).resolves.toBeUndefined();
    const stop = profiler.startSpan('phase');
    expect(() => stop()).not.toThrow();
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
