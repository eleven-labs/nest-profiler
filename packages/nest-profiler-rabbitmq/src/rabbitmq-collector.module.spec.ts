import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ProfilerModule, ProfilerCoreService } from '@eleven-labs/nest-profiler';
import { RabbitMqCollectorModule } from './rabbitmq-collector.module';
import { RabbitMqContextAdapter } from './rabbitmq-context.adapter';

@Controller()
class DummyController {
  @Get('/health')
  health(): { ok: boolean } {
    return { ok: true };
  }
}

describe('RabbitMqCollectorModule', () => {
  describe('forRoot({ enabled: false })', () => {
    it('returns an empty module and registers no adapter', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ProfilerModule.forRoot({ isGlobal: true }),
          RabbitMqCollectorModule.forRoot({ enabled: false }),
        ],
        controllers: [DummyController],
      }).compile();
      const app = moduleRef.createNestApplication();
      await app.init();

      const core = moduleRef.get(ProfilerCoreService, { strict: false });
      expect(core.findContextAdapter('rmq')).toBeUndefined();
      expect(core.getListSections().some((s) => s.key === 'rabbitmq')).toBe(false);

      await app.close();
    });
  });

  describe('forRoot() — enabled (default)', () => {
    it('registers the adapter and entrypoint type (list section) after app.init()', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [ProfilerModule.forRoot({ isGlobal: true }), RabbitMqCollectorModule.forRoot()],
        controllers: [DummyController],
      }).compile();
      const app = moduleRef.createNestApplication();
      await app.init();

      const core = moduleRef.get(ProfilerCoreService, { strict: false });

      const adapter = core.findContextAdapter('rmq');
      expect(adapter).toBeInstanceOf(RabbitMqContextAdapter);
      expect(adapter?.contextType).toBe('rmq');

      const entrypointType = core.getEntrypointType('rabbitmq');
      expect(entrypointType.type).toBe('rabbitmq');

      const section = core.getListSections().find((s) => s.key === 'rabbitmq');
      expect(section).toBeDefined();
      expect(section?.templatePath).toMatch(/rabbitmq-section\.ejs$/);
      expect(
        section?.matches({
          entrypoint: {
            type: 'rabbitmq',
            data: { exchange: 'x', routingKey: 'y' },
          },
          token: 't',
          createdAt: 0,
          performance: { startTime: 0, heapUsed: 0 },
          logs: [],
          exceptions: [],
          collectors: {},
        }),
      ).toBe(true);

      await app.close();
    });
  });

  it('silently skips registration when ProfilerModule is not available', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RabbitMqCollectorModule.forRoot()],
      controllers: [DummyController],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    // No error thrown — the module gracefully handles the missing core.
    const adapter = moduleRef.get(RabbitMqContextAdapter);
    expect(adapter).toBeInstanceOf(RabbitMqContextAdapter);

    await app.close();
  });
});
