import { Test } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ProfilerModule, ProfilerNoopModule } from '@eleven-labs/nest-profiler';
import { EventEmitterCollectorModule } from './event-emitter-collector.module';

/**
 * Bootstrap matrix: the collector must initialise cleanly against both an enabled profiler
 * core and the no-op core (which provides no ClsModule). It injects ClsService lazily and
 * degrades to a no-op, so a disabled core must never break `app.init()`.
 */
describe.each([
  ['enabled core', () => ProfilerModule.forRoot({ isGlobal: true })],
  ['noop core', () => ProfilerNoopModule.forRoot({ isGlobal: true })],
])('EventEmitterCollectorModule bootstrap — %s', (_label, core) => {
  it('initialises the app without a DI error', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [core(), EventEmitterModule.forRoot(), EventEmitterCollectorModule.forRoot()],
    }).compile();

    const app = moduleRef.createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });

  it('initialises without @nestjs/event-emitter registered at all', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [core(), EventEmitterCollectorModule.forRoot()],
    }).compile();

    const app = moduleRef.createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });
});
