import { Test } from '@nestjs/testing';
import type { FactoryProvider } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import {
  ProfilerCoreService,
  ProfilerModule,
  sectionTypeConstraint,
} from '@eleven-labs/nest-profiler';
import { EventEmitterCollectorModule } from './event-emitter-collector.module';
import { EventEmitterCollector } from './event-emitter.collector';
import { EventProfilerService } from './event-profiler.service';
import { EventRouteSource } from './event-route-source';
import { EVENT_EMITTER_COLLECTOR_OPTIONS } from './event-emitter-collector.interface';

async function bootstrap(module: ReturnType<typeof EventEmitterCollectorModule.forRoot>) {
  const moduleRef = await Test.createTestingModule({
    imports: [ProfilerModule.forRoot({ isGlobal: true }), EventEmitterModule.forRoot(), module],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, moduleRef };
}

describe('EventEmitterCollectorModule', () => {
  describe('forRoot({ enabled: false })', () => {
    it('registers no provider at all', () => {
      const dynamic = EventEmitterCollectorModule.forRoot({ enabled: false });
      expect(dynamic).toEqual({ module: EventEmitterCollectorModule });
    });

    it('leaves the core without an event entrypoint or route source', async () => {
      const { app } = await bootstrap(EventEmitterCollectorModule.forRoot({ enabled: false }));
      const core = app.get(ProfilerCoreService, { strict: false });

      expect(core.getRouteSources().some((s) => s.type === 'event')).toBe(false);
      expect(core.getListSections().some((s) => s.key === 'event')).toBe(false);
      await app.close();
    });
  });

  describe('forRoot()', () => {
    it('provides the collector, the patch, the profiler and the route source', () => {
      const dynamic = EventEmitterCollectorModule.forRoot();
      expect(dynamic.providers).toEqual(
        expect.arrayContaining([EventEmitterCollector, EventProfilerService, EventRouteSource]),
      );
    });

    it('registers the event entrypoint type with its list section', async () => {
      const { app } = await bootstrap(EventEmitterCollectorModule.forRoot());
      const core = app.get(ProfilerCoreService, { strict: false });

      const section = core.getListSections().find((s) => s.key === 'event');
      expect(section).toBeDefined();
      expect(section?.templatePath).toContain('events-section.ejs');
      expect(sectionTypeConstraint(section!, core.getListSections())).toEqual({
        typeIn: ['event'],
      });
      await app.close();
    });

    it('registers the Event Listeners route source', async () => {
      const { app } = await bootstrap(EventEmitterCollectorModule.forRoot());
      const core = app.get(ProfilerCoreService, { strict: false });

      const source = core.getRouteSources().find((s) => s.type === 'event');
      expect(source).toBeDefined();
      await app.close();
    });

    it('exposes the scoped event filters', async () => {
      const { app } = await bootstrap(EventEmitterCollectorModule.forRoot());
      const core = app.get(ProfilerCoreService, { strict: false });

      const keys = core.getListFilters().map((f) => f.key);
      expect(keys).toEqual(expect.arrayContaining(['eventStatus', 'eventName']));
      await app.close();
    });

    it('binds the options so the collector reads its thresholds', async () => {
      const { app } = await bootstrap(EventEmitterCollectorModule.forRoot({ slowThreshold: 42 }));
      expect(app.get(EventEmitterCollector, { strict: false }).getTagConfig()).toMatchObject({
        slowThreshold: 42,
      });
      await app.close();
    });
  });

  describe('forRootAsync()', () => {
    it('builds a factory provider for the options token', () => {
      const useFactory = () => ({ slowThreshold: 10 });
      const dynamic = EventEmitterCollectorModule.forRootAsync({ useFactory, inject: [] });

      const optionsProvider = (dynamic.providers ?? []).find(
        (p): p is FactoryProvider =>
          typeof p === 'object' && 'provide' in p && p.provide === EVENT_EMITTER_COLLECTOR_OPTIONS,
      );
      expect(optionsProvider?.useFactory).toBe(useFactory);
      expect(optionsProvider?.inject).toEqual([]);
    });

    it('registers the entrypoint once the app has initialised', async () => {
      const { app } = await bootstrap(
        EventEmitterCollectorModule.forRootAsync({
          useFactory: () => ({ slowThreshold: 10 }),
          inject: [],
        }),
      );
      const core = app.get(ProfilerCoreService, { strict: false });

      expect(core.getListSections().some((s) => s.key === 'event')).toBe(true);
      await app.close();
    });

    it('honours the synchronous enable flag', () => {
      const dynamic = EventEmitterCollectorModule.forRootAsync({
        enabled: false,
        useFactory: () => ({}),
        inject: [],
      });
      expect(dynamic).toEqual({ module: EventEmitterCollectorModule });
    });
  });

  it('silently skips registration when the profiler core is not available', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot(), EventEmitterCollectorModule.forRoot()],
    }).compile();

    const app = moduleRef.createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });
});
