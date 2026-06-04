import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ProfilerModule, ProfilerCoreService } from '@eleven-labs/nest-profiler';
import { ProfilerGraphQLModule } from './profiler-graphql.module';
import { GraphQLContextAdapter } from './adapters/graphql-context.adapter';

@Controller()
class DummyController {
  @Get('/health')
  health(): { ok: boolean } {
    return { ok: true };
  }
}

describe('ProfilerGraphQLModule', () => {
  describe('forRoot({ enabled: false })', () => {
    it('returns an empty module and registers no providers', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ProfilerModule.forRoot({ isGlobal: true }),
          ProfilerGraphQLModule.forRoot({ enabled: false }),
        ],
        controllers: [DummyController],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      const core = moduleRef.get(ProfilerCoreService, { strict: false });
      expect(core.findContextAdapter('graphql')).toBeUndefined();

      await app.close();
    });
  });

  describe('forRoot() — enabled (default)', () => {
    it('registers GraphQLContextAdapter in ProfilerCoreService after app.init()', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [ProfilerModule.forRoot({ isGlobal: true }), ProfilerGraphQLModule.forRoot()],
        controllers: [DummyController],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      const core = moduleRef.get(ProfilerCoreService, { strict: false });
      const adapter = core.findContextAdapter('graphql');
      expect(adapter).toBeInstanceOf(GraphQLContextAdapter);
      expect(adapter?.contextType).toBe('graphql');

      await app.close();
    });

    it('silently skips registration when ProfilerModule is not available', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [ProfilerGraphQLModule.forRoot()],
        controllers: [DummyController],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      // No error thrown — the module gracefully handles the missing core
      const adapter = moduleRef.get(GraphQLContextAdapter);
      expect(adapter).toBeInstanceOf(GraphQLContextAdapter);

      await app.close();
    });
  });
});
