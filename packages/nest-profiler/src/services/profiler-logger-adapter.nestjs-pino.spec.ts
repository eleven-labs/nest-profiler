import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { PinoLogger, LoggerModule } from 'nestjs-pino';
import { ClsServiceManager } from 'nestjs-cls';
import type { ClsService } from 'nestjs-cls';
import { createProfilerLogger } from './profiler-logger-adapter';
import type { Profile } from '../interfaces/profile.interface';

function makeProfile(): Profile {
  return {
    token: 'test',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

/**
 * Integration test proving the profiler log collector works with a REAL
 * third-party logger (nestjs-pino) — not a mock — including pino's own method
 * names (`info`, `trace`) and a directly-injected `PinoLogger`, the exact case
 * that bypasses `app.useLogger()`. No logger-specific code is involved.
 */
describe('createProfilerLogger with nestjs-pino', () => {
  let moduleRef: TestingModule;
  let pino: PinoLogger;
  let lines: Array<{ level: number; msg: string } & Record<string, unknown>>;

  // The logger writes to the process-wide ClsServiceManager singleton.
  const cls: ClsService = ClsServiceManager.getClsService();
  let profile: Profile;

  /** Runs `fn` inside an active CLS context bound to `profile`, so captured logs land on it. */
  function withProfile<T>(fn: () => T): T {
    return cls.run(() => {
      cls.set('profiler.profile', profile);
      return fn();
    });
  }

  // pino maps its own method names to numeric levels.
  const TRACE = 10;
  const DEBUG = 20;
  const INFO = 30;

  beforeAll(async () => {
    lines = [];
    const stream = {
      write: (chunk: string): void => {
        lines.push(JSON.parse(chunk) as { level: number; msg: string } & Record<string, unknown>);
      },
    };

    moduleRef = await Test.createTestingModule({
      imports: [LoggerModule.forRoot({ pinoHttp: [{ level: 'trace' }, stream] })],
    }).compile();

    // PinoLogger is the directly-injectable logger (bypasses app.useLogger).
    pino = await moduleRef.resolve(PinoLogger);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(() => {
    lines.length = 0;
    profile = makeProfile();
  });

  it('captures pino-specific "info" AND has the real pino emit it', () => {
    const logger = createProfilerLogger(pino);

    withProfile(() => logger.info('hello from pino'));

    // 1. Profiler recorded it (info → NestJS "log" level).
    expect(profile.logs[0]).toEqual(
      expect.objectContaining({ level: 'log', message: 'hello from pino' }),
    );
    // 2. The real pino logger actually emitted the line.
    const emitted = lines.find((line) => line.msg === 'hello from pino');
    expect(emitted).toBeDefined();
    expect(emitted?.level).toBe(INFO);
  });

  it('captures pino "trace" as the profiler "verbose" level', () => {
    const logger = createProfilerLogger(pino);

    withProfile(() => logger.trace('tracing'));

    expect(profile.logs[0]).toEqual(expect.objectContaining({ level: 'verbose' }));
    expect(lines.find((line) => line.msg === 'tracing')?.level).toBe(TRACE);
  });

  it('captures NestJS-style "debug" too', () => {
    const logger = createProfilerLogger(pino);

    withProfile(() => logger.debug('debugging'));

    expect(profile.logs[0]).toEqual(expect.objectContaining({ level: 'debug' }));
    expect(lines.find((line) => line.msg === 'debugging')?.level).toBe(DEBUG);
  });

  it('passes pino-specific methods (setContext) straight through without capturing', () => {
    const logger = createProfilerLogger(pino);

    withProfile(() => expect(() => logger.setContext('SomeContext')).not.toThrow());
    expect(profile.logs).toHaveLength(0);
  });

  it('captures the pino object-first convention as message + data', async () => {
    const fresh = await moduleRef.resolve(PinoLogger);
    const logger = createProfilerLogger(fresh);

    withProfile(() => logger.info({ userId: 42 }, 'user logged in'));

    // 1. Profiler stored the message and the merging object as structured data.
    expect(profile.logs[0]).toEqual(
      expect.objectContaining({ level: 'log', message: 'user logged in', data: { userId: 42 } }),
    );
    // 2. The real pino line still carries the merged fields.
    const emitted = lines.find((line) => line.msg === 'user logged in');
    expect(emitted?.['userId']).toBe(42);
  });

  it('falls back to the PinoLogger instance context (the @InjectPinoLogger case)', async () => {
    const fresh = await moduleRef.resolve(PinoLogger);
    fresh.setContext('PostsController');
    const logger = createProfilerLogger(fresh);

    withProfile(() => logger.info('from an injected logger'));

    // The context name never appears in the call args — it lives on the instance.
    expect(profile.logs[0]).toEqual(
      expect.objectContaining({ message: 'from an injected logger', context: 'PostsController' }),
    );
    const emitted = lines.find((line) => line.msg === 'from an injected logger');
    expect(emitted?.['context']).toBe('PostsController');
  });

  it('captures error(err) with the Error serialized as data', async () => {
    const fresh = await moduleRef.resolve(PinoLogger);
    const logger = createProfilerLogger(fresh);

    withProfile(() => logger.error(new Error('kaput')));

    expect(profile.logs[0]).toEqual(expect.objectContaining({ level: 'error', message: 'kaput' }));
    expect(profile.logs[0]?.data).toMatchObject({ name: 'Error', message: 'kaput' });
    expect(lines.length).toBeGreaterThan(0);
  });
});
