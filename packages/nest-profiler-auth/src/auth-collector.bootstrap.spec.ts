import { Test } from '@nestjs/testing';
import { ProfilerModule, ProfilerNoopModule } from '@eleven-labs/nest-profiler';
import { AuthCollectorModule } from './auth-collector.module';

/**
 * Core × collector bootstrap matrix. The collector must initialise cleanly against BOTH an
 * enabled profiler core and the no-op core (which provides no ClsModule). The no-op axis is
 * the MAJ-9 regression guard: a collector left enabled while the core is disabled must inject
 * ClsService lazily/optionally and degrade to a no-op instead of failing DI with
 * "Nest can't resolve dependencies … ClsService".
 */
describe.each([
  ['enabled core', () => ProfilerModule.forRoot({ isGlobal: true })],
  ['noop core', () => ProfilerNoopModule.forRoot({ isGlobal: true })],
])('AuthCollectorModule bootstrap — %s', (_label, core) => {
  it('initialises the app without a DI error', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [core(), AuthCollectorModule.forRoot()],
    }).compile();

    const app = moduleRef.createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });
});
