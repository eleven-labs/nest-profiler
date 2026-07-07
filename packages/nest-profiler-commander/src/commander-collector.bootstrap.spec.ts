import { Test } from '@nestjs/testing';
import { ProfilerModule, ProfilerNoopModule } from '@eleven-labs/nest-profiler';
import { CommanderCollectorModule } from './commander-collector.module';

/**
 * Core × collector bootstrap matrix. The collector must initialise cleanly against BOTH an
 * enabled profiler core and the no-op core (which provides no ClsModule) — the MAJ-9 class of
 * DI regression guard.
 */
describe.each([
  ['enabled core', () => ProfilerModule.forRoot({ isGlobal: true })],
  ['noop core', () => ProfilerNoopModule.forRoot({ isGlobal: true })],
])('CommanderCollectorModule bootstrap — %s', (_label, core) => {
  it('initialises the app without a DI error', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [core(), CommanderCollectorModule.forRoot()],
    }).compile();

    const app = moduleRef.createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });
});
