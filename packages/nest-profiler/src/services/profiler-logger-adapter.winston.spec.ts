import { Writable } from 'node:stream';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import {
  WinstonModule,
  WinstonLogger as NestWinstonLogger,
  WINSTON_MODULE_PROVIDER,
  WINSTON_MODULE_NEST_PROVIDER,
} from 'nest-winston';
import { format, transports } from 'winston';
import type { Logger as Winston } from 'winston';
import { DEFAULT_LOG_METHODS, createProfilerLogger, parseLogArgs } from './profiler-logger-adapter';
import type { ProfilerService } from './nest-profiler.service';
import type { LogEntry } from '../interfaces/profile.interface';

/**
 * Integration test proving the profiler log collector works with a REAL
 * third-party logger (winston via nest-winston) — not a mock — resolved from a
 * NestJS `TestingModule` like in a real application. Covers both DI providers:
 * the NestJS `LoggerService` wrapper (the `app.useLogger()` case, NestJS
 * argument conventions) and the raw winston logger (the direct-injection case,
 * winston-only method names and conventions). No logger-specific code is
 * involved in the adapter itself.
 */
describe('createProfilerLogger with nest-winston', () => {
  let moduleRef: TestingModule;
  let winston: Winston;
  let nestLogger: NestWinstonLogger;
  let addLog: jest.Mock<void, [LogEntry]>;
  let profilerService: Pick<ProfilerService, 'addLog'>;
  let lines: Array<{ level: string; message: string } & Record<string, unknown>>;

  beforeAll(async () => {
    lines = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback): void {
        for (const line of chunk.toString().split('\n').filter(Boolean)) {
          lines.push(JSON.parse(line) as { level: string; message: string });
        }
        callback();
      },
    });

    moduleRef = await Test.createTestingModule({
      imports: [
        WinstonModule.forRoot({
          level: 'silly',
          format: format.combine(format.errors({ stack: true }), format.splat(), format.json()),
          transports: [new transports.Stream({ stream: sink })],
        }),
      ],
    }).compile();

    winston = moduleRef.get<Winston>(WINSTON_MODULE_PROVIDER);
    nestLogger = moduleRef.get<NestWinstonLogger>(WINSTON_MODULE_NEST_PROVIDER);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(() => {
    lines.length = 0;
    addLog = jest.fn<void, [LogEntry]>();
    profilerService = { addLog };
  });

  describe('NestJS LoggerService provider (the app.useLogger case)', () => {
    it('captures log(message, context) AND has the real winston emit it', () => {
      const logger = createProfilerLogger(nestLogger, profilerService);

      logger.log('hello from nest-winston', 'AppService');

      // 1. Profiler recorded the message and the trailing context name.
      expect(addLog).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'log',
          message: 'hello from nest-winston',
          context: 'AppService',
        }),
      );
      // 2. The real winston transport actually emitted the line with the context meta.
      const emitted = lines.find((line) => line.message === 'hello from nest-winston');
      expect(emitted?.level).toBe('info');
      expect(emitted?.['context']).toBe('AppService');
    });

    it('honors the NestJS error(message, stack, context) contract', () => {
      const logger = createProfilerLogger(nestLogger, profilerService);
      const stack = 'Error: boom\n    at handler (file.js:1:1)';

      logger.error('boom', stack, 'AppService');

      // The stack-shaped string lands in data, never mistaken for the context.
      expect(addLog).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          message: 'boom',
          context: 'AppService',
          data: { stack },
        }),
      );
      expect(lines.find((line) => line.message === 'boom')?.level).toBe('error');
    });

    it('captures warn/debug/verbose at their own levels', () => {
      const logger = createProfilerLogger(nestLogger, profilerService);

      logger.warn('www');
      logger.debug?.('ddd');
      logger.verbose?.('vvv');

      expect(addLog).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
      expect(addLog).toHaveBeenCalledWith(expect.objectContaining({ level: 'debug' }));
      expect(addLog).toHaveBeenCalledWith(expect.objectContaining({ level: 'verbose' }));
      expect(lines.find((line) => line.message === 'www')?.level).toBe('warn');
      expect(lines.find((line) => line.message === 'ddd')?.level).toBe('debug');
      expect(lines.find((line) => line.message === 'vvv')?.level).toBe('verbose');
    });

    it('falls back to the instance context set with setContext()', () => {
      const fresh = new NestWinstonLogger(winston);
      fresh.setContext('PostsController');
      const logger = createProfilerLogger(fresh, profilerService);

      logger.log('from an injected logger');

      // The context name never appears in the call args — it lives on the instance.
      expect(addLog).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'from an injected logger', context: 'PostsController' }),
      );
      const emitted = lines.find((line) => line.message === 'from an injected logger');
      expect(emitted?.['context']).toBe('PostsController');
    });
  });

  describe('raw winston logger provider (the direct-injection case)', () => {
    it('captures winston "info" as the profiler "log" level', () => {
      const logger = createProfilerLogger(winston, profilerService);

      logger.info('hello from winston');

      expect(addLog).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'log', message: 'hello from winston' }),
      );
      expect(lines.find((line) => line.message === 'hello from winston')?.level).toBe('info');
    });

    it('captures the message-first meta convention as message + data', () => {
      const logger = createProfilerLogger(winston, profilerService);

      logger.warn('user not found', { userId: 42 });

      // 1. Profiler stored the message and the meta object as structured data.
      expect(addLog).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'warn', message: 'user not found', data: { userId: 42 } }),
      );
      // 2. The real winston line still carries the merged meta field.
      const emitted = lines.find((line) => line.message === 'user not found');
      expect(emitted?.['userId']).toBe(42);
    });

    it('keeps printf interpolation working through the proxy', () => {
      const logger = createProfilerLogger(winston, profilerService);

      logger.info('hello %s', 'world');

      // Profiler keeps the raw template and the interpolation arg as data.
      expect(addLog).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'hello %s', data: 'world' }),
      );
      // winston's splat format produced the interpolated line.
      expect(lines.find((line) => line.message === 'hello world')?.level).toBe('info');
    });

    it('captures winston-only "silly" through an extended LogMethodMap', () => {
      const logger = createProfilerLogger(winston, profilerService, {
        ...DEFAULT_LOG_METHODS,
        silly: 'verbose',
      });

      logger.silly('shhh');

      expect(addLog).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'verbose', message: 'shhh' }),
      );
      expect(lines.find((line) => line.message === 'shhh')?.level).toBe('silly');
    });

    it("supports winston's level-first log(level, message) via a custom parseArgs", () => {
      const logger = createProfilerLogger(winston, profilerService, {
        parseArgs: (method, args, delegate) =>
          method === 'log'
            ? { message: typeof args[1] === 'string' ? args[1] : '' }
            : parseLogArgs(method, args, delegate),
      });

      logger.log('warn', 'level-first call');

      expect(addLog).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'log', message: 'level-first call' }),
      );
      expect(lines.find((line) => line.message === 'level-first call')?.level).toBe('warn');
    });

    it('captures error(err) with the Error serialized as data', () => {
      const logger = createProfilerLogger(winston, profilerService);

      logger.error(new Error('kaput'));

      expect(addLog).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'error', message: 'kaput' }),
      );
      const entry = addLog.mock.calls[0]?.[0];
      expect(entry?.data).toMatchObject({ name: 'Error', message: 'kaput' });
      // The real winston line carries the message and the stack (errors format).
      const emitted = lines.find((line) => line.message === 'kaput');
      expect(emitted?.['stack']).toContain('kaput');
    });

    it('passes winston-specific members (level, child) straight through without capturing', () => {
      const logger = createProfilerLogger(winston, profilerService);

      expect(logger.level).toBe('silly');
      expect(() => logger.child({ requestId: 'r1' })).not.toThrow();
      expect(addLog).not.toHaveBeenCalled();
    });
  });
});
