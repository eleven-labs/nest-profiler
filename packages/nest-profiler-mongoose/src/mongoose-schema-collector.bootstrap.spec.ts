import { Test } from '@nestjs/testing';
import { ProfilerModule, ProfilerNoopModule } from '@eleven-labs/nest-profiler';
import { MongooseSchemaCollectorModule } from './mongoose-schema-collector.module';

/**
 * Bootstrap matrix: with no connection present the collector introspects nothing and no-ops,
 * so it must initialise cleanly against both an enabled profiler core and the no-op core —
 * `app.init()` must succeed in both.
 */
describe.each([
  ['enabled core', () => ProfilerModule.forRoot({ isGlobal: true })],
  ['noop core', () => ProfilerNoopModule.forRoot({ isGlobal: true })],
])('MongooseSchemaCollectorModule bootstrap — %s', (_label, core) => {
  it('initialises the app without a DI error', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [core(), MongooseSchemaCollectorModule.forRoot()],
    }).compile();

    const app = moduleRef.createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });
});
