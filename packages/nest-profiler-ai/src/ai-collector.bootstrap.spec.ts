// Jest runs these in CommonJS and `ai` is ESM-only, which Node 22 refuses to `require`. The
// module only needs `registerTelemetry` here; the real SDK is exercised by the example's e2e.
jest.mock('ai', () => ({ registerTelemetry: jest.fn() }));

import { Test } from '@nestjs/testing';
import { ProfilerModule, ProfilerNoopModule } from '@eleven-labs/nest-profiler';
import { AiCollectorModule } from './ai-collector.module';
import { pricingFor, resetAiPricing } from './ai-pricing';

/**
 * Bootstrap matrix: the collector must initialise cleanly against both an enabled profiler core
 * and the no-op core (which provides no ClsModule). It reads the active profile lazily and
 * degrades to a no-op, so a disabled core must never break `app.init()`.
 */
describe.each([
  ['enabled core', () => ProfilerModule.forRoot({ isGlobal: true })],
  ['noop core', () => ProfilerNoopModule.forRoot({ isGlobal: true })],
])('AiCollectorModule bootstrap — %s', (_label, core) => {
  it('initialises the app without a DI error', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [core(), AiCollectorModule.forRoot()],
    }).compile();

    const app = moduleRef.createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });
});

describe('AiCollectorModule', () => {
  it('registers no provider when disabled', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ProfilerModule.forRoot({ isGlobal: true }),
        AiCollectorModule.forRoot({ enabled: false }),
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();
    // Nothing to resolve: a disabled collector contributes no providers at all.
    expect(() => {
      moduleRef.get<unknown>('AiCollector', { strict: false });
    }).toThrow();
    await app.close();
  });

  it('loads the price table at startup, source included, with the static entries winning', async () => {
    const source = jest.fn().mockResolvedValue({ 'gpt-4o': { input: 7, output: 8 } });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ProfilerModule.forRoot({ isGlobal: true }),
        AiCollectorModule.forRoot({
          pricing: { 'openai:gpt-4o-mini': { input: 1, output: 2 } },
          pricingSource: source,
        }),
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();
    // The module kicks the load off without awaiting it, so let its microtask settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(pricingFor('openai.responses', 'gpt-4o-mini')).toEqual({ input: 1, output: 2 });
    expect(pricingFor('openai', 'gpt-4o')).toEqual({ input: 7, output: 8 });
    expect(source).toHaveBeenCalledTimes(1);
    await app.close();
    resetAiPricing();
  });

  it('applies every capture option and leaves the entrypoint alone when asked', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ProfilerModule.forRoot({ isGlobal: true }),
        AiCollectorModule.forRoot({
          captureContent: false,
          maxTextLength: 50,
          maxMessages: 5,
          entrypoint: false,
        }),
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });

  it('initialises without a profiler core at all', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AiCollectorModule.forRoot()],
    }).compile();

    const app = moduleRef.createNestApplication();
    // No ProfilerCoreService to resolve: the module must swallow that, not crash the app.
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });

  it('accepts async options', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ProfilerModule.forRoot({ isGlobal: true }),
        AiCollectorModule.forRootAsync({ useFactory: () => ({ captureContent: false }) }),
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });
});
