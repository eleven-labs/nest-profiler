import { Test } from '@nestjs/testing';
import { ProfilerModule, ProfilerNoopModule } from '@eleven-labs/nest-profiler';
import { HttpCollectorModule } from './http-collector.module';
import { AxiosInstrumentation } from './axios';
import { FetchInstrumentation } from './fetch';

/**
 * Bootstrap matrix: the collector must initialise cleanly against both an enabled profiler
 * core and the no-op core (which provides no ClsModule). It injects ClsService lazily and
 * degrades to a no-op, so a disabled core must never break `app.init()`. The selected adapters
 * install at bootstrap (via the runner) and must not fail DI or crash init either way.
 */
describe.each([
  ['enabled core', () => ProfilerModule.forRoot({ isGlobal: true })],
  ['noop core', () => ProfilerNoopModule.forRoot({ isGlobal: true })],
])('HttpCollectorModule bootstrap — %s', (_label, core) => {
  it('initialises with no instrumentations selected', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [core(), HttpCollectorModule.forRoot()],
    }).compile();

    const app = moduleRef.createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });

  it('initialises with the axios and fetch adapters selected', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        core(),
        HttpCollectorModule.forRoot({
          instrumentations: [AxiosInstrumentation, FetchInstrumentation],
        }),
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });
});
