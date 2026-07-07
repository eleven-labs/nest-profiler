import { Test } from '@nestjs/testing';
import { ProfilerModule, ProfilerNoopModule } from '@eleven-labs/nest-profiler';
import { GraphQLCollectorModule } from './graphql-collector.module';

/**
 * Bootstrap matrix: the collector resolves the GraphQL plugin surface lazily (ModuleRef,
 * @Optional), so it must initialise cleanly against both an enabled profiler core and the
 * no-op core (which provides no ClsModule), with no GraphQL server present.
 */
describe.each([
  ['enabled core', () => ProfilerModule.forRoot({ isGlobal: true })],
  ['noop core', () => ProfilerNoopModule.forRoot({ isGlobal: true })],
])('GraphQLCollectorModule bootstrap — %s', (_label, core) => {
  it('initialises the app without a DI error', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [core(), GraphQLCollectorModule.forRoot()],
    }).compile();

    const app = moduleRef.createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });
});
