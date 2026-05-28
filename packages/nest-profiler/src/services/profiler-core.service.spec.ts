import { Test } from '@nestjs/testing';
import { ProfilerCoreService } from './profiler-core.service';
import { ProfilerStorageService } from './profiler-storage.service';
import { CollectorRegistry } from '../collectors/collector-registry.service';
import { RouteCollector } from '../collectors/route.collector';

describe('ProfilerCoreService', () => {
  it('exposes the injected storage, collector registry and route collector', async () => {
    const storage = { findAll: jest.fn() } as unknown as ProfilerStorageService;
    const collectorRegistry = { buildPanels: jest.fn() } as unknown as CollectorRegistry;
    const routeCollector = { match: jest.fn() } as unknown as RouteCollector;

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProfilerCoreService,
        { provide: ProfilerStorageService, useValue: storage },
        { provide: CollectorRegistry, useValue: collectorRegistry },
        { provide: RouteCollector, useValue: routeCollector },
      ],
    }).compile();

    const core = moduleRef.get(ProfilerCoreService);
    expect(core.storage).toBe(storage);
    expect(core.collectorRegistry).toBe(collectorRegistry);
    expect(core.routeCollector).toBe(routeCollector);
  });
});
