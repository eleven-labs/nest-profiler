import { Test } from '@nestjs/testing';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { CollectorRegistry, ProfilerModule, ProfilerNoopModule } from '@eleven-labs/nest-profiler';
import { RabbitMqPublishCollectorModule } from './rabbitmq-publish-collector.module';

/**
 * Bootstrap matrix: the collector must initialise cleanly against both an enabled profiler core
 * and the no-op core (which provides no ClsModule). It injects ClsService lazily and degrades to
 * a no-op, so a disabled core must never break `app.init()`.
 */
describe.each([
  ['enabled core', () => ProfilerModule.forRoot({ isGlobal: true })],
  ['noop core', () => ProfilerNoopModule.forRoot({ isGlobal: true })],
])('RabbitMqPublishCollectorModule bootstrap — %s', (_label, core) => {
  // Aliased as a plain property bag: the module patches golevelup's real prototype, and this spec
  // only snapshots, compares and restores `publish` — it never calls it.
  const prototype = AmqpConnection.prototype as { publish: unknown };
  const original = prototype.publish;

  afterEach(() => {
    prototype.publish = original;
  });

  it('initialises the app without a DI error', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [core(), RabbitMqPublishCollectorModule.forRoot()],
    }).compile();

    const app = moduleRef.createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });
});

describe('RabbitMqPublishCollectorModule with an enabled core', () => {
  // Aliased as a plain property bag: the module patches golevelup's real prototype, and this spec
  // only snapshots, compares and restores `publish` — it never calls it.
  const prototype = AmqpConnection.prototype as { publish: unknown };
  const original = prototype.publish;

  afterEach(() => {
    prototype.publish = original;
  });

  it('registers the AMQP panel and instruments AmqpConnection.publish', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ProfilerModule.forRoot({ isGlobal: true }),
        RabbitMqPublishCollectorModule.forRoot(),
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const registry = moduleRef.get(CollectorRegistry, { strict: false });
    expect(registry.getCollectors().map((collector) => collector.name)).toContain(
      'rabbitmq-publish',
    );
    expect(prototype.publish).not.toBe(original);

    await app.close();
  });

  it('leaves publish untouched when the collector is disabled', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ProfilerModule.forRoot({ isGlobal: true }),
        RabbitMqPublishCollectorModule.forRoot({ enabled: false }),
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const registry = moduleRef.get(CollectorRegistry, { strict: false });
    expect(registry.getCollectors().map((collector) => collector.name)).not.toContain(
      'rabbitmq-publish',
    );
    expect(prototype.publish).toBe(original);

    await app.close();
  });
});
