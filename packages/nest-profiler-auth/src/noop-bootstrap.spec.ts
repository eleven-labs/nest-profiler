import { Test } from '@nestjs/testing';
import { ProfilerNoopModule } from '@eleven-labs/nest-profiler';
import { AuthCollectorModule } from './auth-collector.module';

/**
 * MAJ-9 regression guard: a collector left enabled while the profiler core is disabled (here via
 * ProfilerNoopModule, which provides no ClsModule) must boot cleanly — the collector injects
 * ClsService as @Optional and degrades to a no-op instead of failing DI with
 * "Nest can't resolve dependencies … ClsService".
 */
describe('bootstrap with a disabled core (MAJ-9)', () => {
  it('ProfilerNoopModule + AuthCollectorModule initializes without a ClsService DI error', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProfilerNoopModule.forRoot({ isGlobal: true }), AuthCollectorModule.forRoot()],
    }).compile();

    const app = moduleRef.createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });
});
