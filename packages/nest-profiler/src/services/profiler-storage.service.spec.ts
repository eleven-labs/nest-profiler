import { Test } from '@nestjs/testing';
import { ProfilerStorageService } from './profiler-storage.service';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import { PROFILER_STORAGE_ADAPTER, type IProfilerStorageAdapter } from '../storage';
import type { Profile } from '../interfaces/profile.interface';

function makeProfile(token: string, createdAt = Date.now()): Profile {
  return {
    token,
    createdAt,
    request: { method: 'GET', url: '/', headers: {}, query: {} },
    performance: { startTime: createdAt, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

describe('ProfilerStorageService', () => {
  let service: ProfilerStorageService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ProfilerStorageService,
        { provide: NEST_PROFILER_MODULE_OPTIONS, useValue: { maxProfiles: 3, ttl: 3600 } },
      ],
    }).compile();
    service = module.get(ProfilerStorageService);
  });

  it('saves and retrieves a profile', async () => {
    const p = makeProfile('abc');
    await service.save(p);
    expect(await service.findOne('abc')).toBe(p);
  });

  it('returns undefined for unknown token', async () => {
    expect(await service.findOne('unknown')).toBeUndefined();
  });

  it('findAll returns most-recent first', async () => {
    await service.save(makeProfile('a'));
    await service.save(makeProfile('b'));
    await service.save(makeProfile('c'));
    const tokens = (await service.findAll()).map((p) => p.token);
    expect(tokens).toEqual(['c', 'b', 'a']);
  });

  it('evicts oldest profile when maxProfiles is exceeded', async () => {
    await service.save(makeProfile('a'));
    await service.save(makeProfile('b'));
    await service.save(makeProfile('c'));
    await service.save(makeProfile('d'));
    expect(await service.findOne('a')).toBeUndefined();
    expect(await service.findOne('d')).toBeDefined();
  });

  it('filters expired profiles by TTL', async () => {
    const old = makeProfile('old', Date.now() - 4000 * 1000);
    await service.save(old);
    expect(await service.findOne('old')).toBeUndefined();
    expect(await service.findAll()).toHaveLength(0);
  });

  it('clear() removes all profiles', async () => {
    await service.save(makeProfile('x'));
    await service.clear();
    expect(await service.findAll()).toHaveLength(0);
  });

  it('falls back to an in-memory adapter when no options token is provided', async () => {
    const module = await Test.createTestingModule({
      providers: [ProfilerStorageService],
    }).compile();
    const svc = module.get(ProfilerStorageService);
    const p = makeProfile('default');
    await svc.save(p);
    expect(await svc.findOne('default')).toBe(p);
  });

  it('reports crossProcess=false for the default in-memory adapter', async () => {
    const module = await Test.createTestingModule({
      providers: [ProfilerStorageService],
    }).compile();
    expect(module.get(ProfilerStorageService).crossProcess).toBe(false);
  });

  it('reflects a custom adapter crossProcess flag', async () => {
    const shared = { crossProcess: true } as unknown as IProfilerStorageAdapter;
    const sharedSvc = (
      await Test.createTestingModule({
        providers: [
          ProfilerStorageService,
          { provide: PROFILER_STORAGE_ADAPTER, useValue: shared },
        ],
      }).compile()
    ).get(ProfilerStorageService);
    expect(sharedSvc.crossProcess).toBe(true);
  });

  it('defaults crossProcess to true when a custom adapter omits the flag', async () => {
    const custom = { save: jest.fn() } as unknown as IProfilerStorageAdapter;
    const svc = (
      await Test.createTestingModule({
        providers: [
          ProfilerStorageService,
          { provide: PROFILER_STORAGE_ADAPTER, useValue: custom },
        ],
      }).compile()
    ).get(ProfilerStorageService);
    expect(svc.crossProcess).toBe(true);
  });

  it('delegates to a custom storage adapter when provided', async () => {
    const save = jest.fn();
    const findAll = jest.fn().mockReturnValue([]);
    const findOne = jest.fn().mockReturnValue(undefined);
    const clear = jest.fn();
    const custom = { save, findAll, findOne, clear } as unknown as IProfilerStorageAdapter;
    const module = await Test.createTestingModule({
      providers: [ProfilerStorageService, { provide: PROFILER_STORAGE_ADAPTER, useValue: custom }],
    }).compile();
    const svc = module.get(ProfilerStorageService);

    const p = makeProfile('y');
    await svc.save(p);
    await svc.findAll({ method: 'GET' });
    await svc.findOne('y');
    await svc.clear();

    expect(save).toHaveBeenCalledWith(p);
    expect(findAll).toHaveBeenCalledWith({ method: 'GET' });
    expect(findOne).toHaveBeenCalledWith('y');
    expect(clear).toHaveBeenCalled();
  });
});
