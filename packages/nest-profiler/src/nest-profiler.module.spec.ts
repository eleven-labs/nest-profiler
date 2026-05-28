import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Test } from '@nestjs/testing';
import { ProfilerModule } from './nest-profiler.module';
import { ProfilerService } from './services/nest-profiler.service';
import { ProfilerStorageService } from './services/profiler-storage.service';
import { CollectorRegistry } from './collectors/collector-registry.service';
import type { IProfilerStorageAdapter } from './storage';
import type { Profile } from './interfaces/profile.interface';

function makeProfile(token: string): Profile {
  return {
    token,
    createdAt: Date.now(),
    request: { method: 'GET', url: '/', headers: {}, query: {} },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

describe('ProfilerModule', () => {
  it('forRoot() registers core providers', async () => {
    const module = await Test.createTestingModule({
      imports: [ProfilerModule.forRoot()],
    }).compile();
    expect(module.get(ProfilerService)).toBeInstanceOf(ProfilerService);
    expect(module.get(ProfilerStorageService)).toBeInstanceOf(ProfilerStorageService);
    expect(module.get(CollectorRegistry)).toBeInstanceOf(CollectorRegistry);
    await module.close();
  });

  it('forRoot({ enabled: false }) registers only the inert ProfilerService', async () => {
    const module = await Test.createTestingModule({
      imports: [ProfilerModule.forRoot({ enabled: false })],
    }).compile();
    // ProfilerService stays injectable everywhere (main.ts, consumer services)…
    expect(module.get(ProfilerService)).toBeInstanceOf(ProfilerService);
    // …but the active layer is absent.
    expect(() => module.get(CollectorRegistry)).toThrow();
    expect(() => module.get(ProfilerStorageService)).toThrow();
    await module.close();
  });

  it('forRoot({ enabled: false }) does not register the profiler controller', () => {
    const mod = ProfilerModule.forRoot({ enabled: false });
    expect(mod.controllers ?? []).toHaveLength(0);
  });

  it('forRoot({ isGlobal: true }) sets global: true on DynamicModule', () => {
    const mod = ProfilerModule.forRoot({ isGlobal: true });
    expect(mod.global).toBe(true);
  });

  it('forRoot({ isGlobal: false }) sets global: false by default', () => {
    const mod = ProfilerModule.forRoot();
    expect(mod.global).toBe(false);
  });

  it('forRoot({ storageType: "file" }) wires a file-backed storage service', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'profiler-mod-'));
    const module = await Test.createTestingModule({
      imports: [ProfilerModule.forRoot({ storageType: 'file', storagePath: dir })],
    }).compile();
    const svc = module.get(ProfilerStorageService);
    const p = makeProfile('file-token');
    await svc.save(p);
    expect((await svc.findOne('file-token'))?.token).toBe('file-token');
    await module.close();
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('forRoot({ storage }) uses the provided custom adapter (takes precedence)', async () => {
    const save = jest.fn();
    const custom = {
      save,
      findAll: jest.fn().mockReturnValue([]),
      findOne: jest.fn().mockReturnValue(undefined),
      clear: jest.fn(),
    } as unknown as IProfilerStorageAdapter;
    const module = await Test.createTestingModule({
      imports: [ProfilerModule.forRoot({ storage: custom })],
    }).compile();
    await module.get(ProfilerStorageService).save(makeProfile('z'));
    expect(save).toHaveBeenCalled();
    await module.close();
  });

  it('forRootAsync() resolves options via useFactory', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ProfilerModule.forRootAsync({
          useFactory: () => ({ enabled: true, maxProfiles: 50 }),
        }),
      ],
    }).compile();
    expect(module.get(ProfilerService)).toBeInstanceOf(ProfilerService);
    await module.close();
  });
});
