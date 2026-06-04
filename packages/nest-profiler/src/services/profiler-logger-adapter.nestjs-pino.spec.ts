import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { PinoLogger, LoggerModule } from 'nestjs-pino';
import { createProfilerLogger } from './profiler-logger-adapter';
import type { ProfilerService } from './nest-profiler.service';

/**
 * Integration test proving the profiler log collector works with a REAL
 * third-party logger (nestjs-pino) — not a mock — including pino's own method
 * names (`info`, `trace`) and a directly-injected `PinoLogger`, the exact case
 * that bypasses `app.useLogger()`. No logger-specific code is involved.
 */
describe('createProfilerLogger with nestjs-pino', () => {
  let moduleRef: TestingModule;
  let pino: PinoLogger;
  let addLog: jest.Mock;
  let profilerService: Pick<ProfilerService, 'addLog'>;
  let lines: Array<{ level: number; msg: string }>;

  // pino maps its own method names to numeric levels.
  const TRACE = 10;
  const DEBUG = 20;
  const INFO = 30;

  beforeAll(async () => {
    lines = [];
    const stream = {
      write: (chunk: string): void => {
        lines.push(JSON.parse(chunk) as { level: number; msg: string });
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
    addLog = jest.fn();
    profilerService = { addLog };
  });

  it('captures pino-specific "info" AND has the real pino emit it', () => {
    const logger = createProfilerLogger(pino, profilerService);

    logger.info('hello from pino');

    // 1. Profiler recorded it (info → NestJS "log" level).
    expect(addLog).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'log', message: 'hello from pino' }),
    );
    // 2. The real pino logger actually emitted the line.
    const emitted = lines.find((line) => line.msg === 'hello from pino');
    expect(emitted).toBeDefined();
    expect(emitted?.level).toBe(INFO);
  });

  it('captures pino "trace" as the profiler "verbose" level', () => {
    const logger = createProfilerLogger(pino, profilerService);

    logger.trace('tracing');

    expect(addLog).toHaveBeenCalledWith(expect.objectContaining({ level: 'verbose' }));
    expect(lines.find((line) => line.msg === 'tracing')?.level).toBe(TRACE);
  });

  it('captures NestJS-style "debug" too', () => {
    const logger = createProfilerLogger(pino, profilerService);

    logger.debug('debugging');

    expect(addLog).toHaveBeenCalledWith(expect.objectContaining({ level: 'debug' }));
    expect(lines.find((line) => line.msg === 'debugging')?.level).toBe(DEBUG);
  });

  it('passes pino-specific methods (setContext) straight through without capturing', () => {
    const logger = createProfilerLogger(pino, profilerService);

    expect(() => logger.setContext('SomeContext')).not.toThrow();
    expect(addLog).not.toHaveBeenCalled();
  });
});
