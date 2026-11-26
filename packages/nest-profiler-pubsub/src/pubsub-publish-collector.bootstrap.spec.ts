import { Test } from '@nestjs/testing';
import { Topic } from '@google-cloud/pubsub';
import { CollectorRegistry, ProfilerModule, ProfilerNoopModule } from '@eleven-labs/nest-profiler';
import { PubSubPublishCollectorModule } from './pubsub-publish-collector.module.js';

// Aliased as a plain property bag: the module patches the client's real prototype, and these
// specs only snapshot, compare and restore `publishMessage` — they never call it.
const prototype = Topic.prototype as unknown as { publishMessage: unknown };
const original = prototype.publishMessage;

/**
 * Bootstrap matrix: the collector must initialise cleanly against both an enabled profiler core
 * and the no-op core (which provides no ClsModule). It injects ClsService lazily and degrades to
 * a no-op, so a disabled core must never break `app.init()`.
 */
describe.each([
  ['enabled core', () => ProfilerModule.forRoot({ isGlobal: true })],
  ['noop core', () => ProfilerNoopModule.forRoot({ isGlobal: true })],
])('PubSubPublishCollectorModule bootstrap — %s', (_label, core) => {
  afterEach(() => {
    prototype.publishMessage = original;
  });

  it('initialises the app without a DI error', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [core(), PubSubPublishCollectorModule.forRoot()],
    }).compile();

    const app = moduleRef.createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });
});

describe('PubSubPublishCollectorModule with an enabled core', () => {
  afterEach(() => {
    prototype.publishMessage = original;
  });

  it('registers the Pub/Sub panel and instruments Topic.publishMessage', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProfilerModule.forRoot({ isGlobal: true }), PubSubPublishCollectorModule.forRoot()],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const registry = moduleRef.get(CollectorRegistry, { strict: false });
    expect(registry.getCollectors().map((collector) => collector.name)).toContain('pubsub-publish');
    expect(prototype.publishMessage).not.toBe(original);

    await app.close();
  });

  it('leaves publishMessage untouched when the collector is disabled', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ProfilerModule.forRoot({ isGlobal: true }),
        PubSubPublishCollectorModule.forRoot({ enabled: false }),
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const registry = moduleRef.get(CollectorRegistry, { strict: false });
    expect(registry.getCollectors().map((collector) => collector.name)).not.toContain(
      'pubsub-publish',
    );
    expect(prototype.publishMessage).toBe(original);

    await app.close();
  });
});
