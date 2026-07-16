import { Test } from '@nestjs/testing';
import { ProfilerModule, ProfilerNoopModule } from '@eleven-labs/nest-profiler';
import { ValidatorCollectorModule } from './validator-collector.module';

/**
 * Bootstrap matrix: the panel-only collector must initialise cleanly against both an enabled
 * profiler core and the no-op core, so registering it never breaks `app.init()`.
 */
describe.each([
  ['enabled core', () => ProfilerModule.forRoot({ isGlobal: true })],
  ['noop core', () => ProfilerNoopModule.forRoot({ isGlobal: true })],
])('ValidatorCollectorModule bootstrap — %s', (_label, core) => {
  it('initialises the app without a DI error', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [core(), ValidatorCollectorModule.forRoot()],
    }).compile();

    const app = moduleRef.createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });
});
