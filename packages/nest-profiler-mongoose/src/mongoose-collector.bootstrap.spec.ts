import { Test } from '@nestjs/testing';
import { ProfilerModule, ProfilerNoopModule } from '@eleven-labs/nest-profiler';
import { MongooseCollectorModule } from './mongoose-collector.module';

/**
 * Bootstrap matrix: with no Connection present the connection patch resolves nothing and
 * no-ops, so the collector must initialise cleanly against both an enabled profiler core and
 * the no-op core (which provides no ClsModule) — `app.init()` must succeed in both.
 */
describe.each([
  ['enabled core', () => ProfilerModule.forRoot({ isGlobal: true })],
  ['noop core', () => ProfilerNoopModule.forRoot({ isGlobal: true })],
])('MongooseCollectorModule bootstrap — %s', (_label, core) => {
  it('initialises the app without a DI error', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [core(), MongooseCollectorModule.forRoot()],
    }).compile();

    const app = moduleRef.createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });
});
