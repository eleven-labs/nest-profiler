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
import { ClsServiceManager } from 'nestjs-cls';
import type { ClsService } from 'nestjs-cls';
import { DEFAULT_LOG_METHODS, createProfilerLogger, parseLogArgs } from './profiler-logger-adapter';
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
  let lines: Array<{ level: string; message: string } & Record<string, unknown>>;

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
    profile = makeProfile();
  });

  describe('NestJS LoggerService provider (the app.useLogger case)', () => {
    it('captures log(message, context) AND has the real winston emit it', () => {
      const logger = createProfilerLogger(nestLogger);

      withProfile(() => void logger.log('hello from nest-winston', 'AppService'));

      // 1. Profiler recorded the message and the trailing context name.
      expect(profile.logs[0]).toEqual(
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
      const logger = createProfilerLogger(nestLogger);
      const stack = 'Error: boom\n    at handler (file.js:1:1)';

      withProfile(() => void logger.error('boom', stack, 'AppService'));

      // The stack-shaped string lands in data, never mistaken for the context.
      expect(profile.logs[0]).toEqual(
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
      const logger = createProfilerLogger(nestLogger);

      withProfile(() => {
        logger.warn('www');
        logger.debug?.('ddd');
        logger.verbose?.('vvv');
      });

      expect(profile.logs).toContainEqual(expect.objectContaining({ level: 'warn' }));
      expect(profile.logs).toContainEqual(expect.objectContaining({ level: 'debug' }));
      expect(profile.logs).toContainEqual(expect.objectContaining({ level: 'verbose' }));
      expect(lines.find((line) => line.message === 'www')?.level).toBe('warn');
      expect(lines.find((line) => line.message === 'ddd')?.level).toBe('debug');
      expect(lines.find((line) => line.message === 'vvv')?.level).toBe('verbose');
    });

    it('falls back to the instance context set with setContext()', () => {
      const fresh = new NestWinstonLogger(winston);
      fresh.setContext('PostsController');
      const logger = createProfilerLogger(fresh);

      withProfile(() => void logger.log('from an injected logger'));

      // The context name never appears in the call args — it lives on the instance.
      expect(profile.logs[0]).toEqual(
        expect.objectContaining({ message: 'from an injected logger', context: 'PostsController' }),
      );
      const emitted = lines.find((line) => line.message === 'from an injected logger');
      expect(emitted?.['context']).toBe('PostsController');
    });
  });

  describe('raw winston logger provider (the direct-injection case)', () => {
    it('captures winston "info" as the profiler "log" level', () => {
      const logger = createProfilerLogger(winston);

      withProfile(() => logger.info('hello from winston'));

      expect(profile.logs[0]).toEqual(
        expect.objectContaining({ level: 'log', message: 'hello from winston' }),
      );
      expect(lines.find((line) => line.message === 'hello from winston')?.level).toBe('info');
    });

    it('captures the message-first meta convention as message + data', () => {
      const logger = createProfilerLogger(winston);

      withProfile(() => logger.warn('user not found', { userId: 42 }));

      // 1. Profiler stored the message and the meta object as structured data.
      expect(profile.logs[0]).toEqual(
        expect.objectContaining({ level: 'warn', message: 'user not found', data: { userId: 42 } }),
      );
      // 2. The real winston line still carries the merged meta field.
      const emitted = lines.find((line) => line.message === 'user not found');
      expect(emitted?.['userId']).toBe(42);
    });

    it('keeps printf interpolation working through the proxy', () => {
      const logger = createProfilerLogger(winston);

      withProfile(() => logger.info('hello %s', 'world'));

      // Profiler keeps the raw template and the interpolation arg as data.
      expect(profile.logs[0]).toEqual(
        expect.objectContaining({ message: 'hello %s', data: 'world' }),
      );
      // winston's splat format produced the interpolated line.
      expect(lines.find((line) => line.message === 'hello world')?.level).toBe('info');
    });

    it('captures winston-only "silly" through an extended LogMethodMap', () => {
      const logger = createProfilerLogger(winston, {
        ...DEFAULT_LOG_METHODS,
        silly: 'verbose',
      });

      withProfile(() => logger.silly('shhh'));

      expect(profile.logs[0]).toEqual(
        expect.objectContaining({ level: 'verbose', message: 'shhh' }),
      );
      expect(lines.find((line) => line.message === 'shhh')?.level).toBe('silly');
    });

    it("supports winston's level-first log(level, message) via a custom parseArgs", () => {
      const logger = createProfilerLogger(winston, {
        parseArgs: (method, args, delegate) =>
          method === 'log'
            ? { message: typeof args[1] === 'string' ? args[1] : '' }
            : parseLogArgs(method, args, delegate),
      });

      withProfile(() => logger.log('warn', 'level-first call'));

      expect(profile.logs[0]).toEqual(
        expect.objectContaining({ level: 'log', message: 'level-first call' }),
      );
      expect(lines.find((line) => line.message === 'level-first call')?.level).toBe('warn');
    });

    it('captures error(err) with the Error serialized as data', () => {
      const logger = createProfilerLogger(winston);

      withProfile(() => logger.error(new Error('kaput')));

      expect(profile.logs[0]).toEqual(
        expect.objectContaining({ level: 'error', message: 'kaput' }),
      );
      expect(profile.logs[0]?.data).toMatchObject({ name: 'Error', message: 'kaput' });
      // The real winston line carries the message and the stack (errors format).
      const emitted = lines.find((line) => line.message === 'kaput');
      expect(emitted?.['stack']).toContain('kaput');
    });

    it('passes winston-specific members (level, child) straight through without capturing', () => {
      const logger = createProfilerLogger(winston);

      withProfile(() => {
        expect(logger.level).toBe('silly');
        expect(() => logger.child({ requestId: 'r1' })).not.toThrow();
      });
      expect(profile.logs).toHaveLength(0);
    });
  });
});
