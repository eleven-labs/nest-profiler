import { createProfilerLogger, DEFAULT_LOG_METHODS, parseLogArgs } from './profiler-logger-adapter';
import type { ProfilerService } from './nest-profiler.service';
import type { LogEntry, LogLevel } from '../interfaces/profile.interface';

describe('createProfilerLogger', () => {
  let addLog: jest.Mock<void, [LogEntry]>;
  let profilerService: Pick<ProfilerService, 'addLog'>;

  beforeEach(() => {
    addLog = jest.fn<void, [LogEntry]>();
    profilerService = { addLog };
  });

  const levels: LogLevel[] = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'];

  it.each(levels)('captures the "%s" level and delegates to the underlying logger', (level) => {
    const delegate = { [level]: jest.fn() } as Record<string, jest.Mock>;
    const logger = createProfilerLogger(delegate, profilerService);

    logger[level]?.('hello', 'MyContext');

    expect(addLog).toHaveBeenCalledWith(
      expect.objectContaining({ level, message: 'hello', context: 'MyContext' }),
    );
    expect(delegate[level]).toHaveBeenCalledWith('hello', 'MyContext');
  });

  it.each([
    ['info', 'log'],
    ['trace', 'verbose'],
  ] as const)(
    'captures the third-party alias "%s" as the "%s" profiler level',
    (method, expectedLevel) => {
      const delegate = { [method]: jest.fn() } as Record<string, jest.Mock>;
      const logger = createProfilerLogger(delegate, profilerService);

      logger[method]?.('hi');

      expect(addLog).toHaveBeenCalledWith(expect.objectContaining({ level: expectedLevel }));
      expect(delegate[method]).toHaveBeenCalledWith('hi');
    },
  );

  it('passes non-level methods and properties straight through to the delegate', () => {
    const delegate = {
      log: jest.fn(),
      setContext: jest.fn(),
      name: 'structured',
    };
    const logger = createProfilerLogger(delegate, profilerService);

    logger.setContext('Ctx');
    expect(delegate.setContext).toHaveBeenCalledWith('Ctx');
    expect(addLog).not.toHaveBeenCalled();
    expect(logger.name).toBe('structured');
  });

  describe('argument conventions', () => {
    const capture = (...args: unknown[]): LogEntry => {
      const delegate = { log: jest.fn(), error: jest.fn() } as Record<string, jest.Mock>;
      const logger = createProfilerLogger(delegate, profilerService) as Record<
        string,
        (...callArgs: unknown[]) => unknown
      >;
      const [method, ...callArgs] = args as [string, ...unknown[]];
      logger[method]?.(...callArgs);
      expect(delegate[method]).toHaveBeenCalledWith(...callArgs);
      const entry = addLog.mock.calls[0]?.[0];
      if (entry === undefined) {
        throw new Error('addLog was not called');
      }
      return entry;
    };

    it('treats a trailing string as the NestJS context name', () => {
      expect(capture('log', 'hi', 'Ctx')).toMatchObject({ message: 'hi', context: 'Ctx' });
    });

    it('captures a payload object between message and context name', () => {
      expect(capture('log', 'hi', { a: 1 }, 'Ctx')).toMatchObject({
        message: 'hi',
        context: 'Ctx',
        data: { a: 1 },
      });
    });

    it('captures the message-first payload style log(message, object)', () => {
      expect(capture('log', 'hi', { a: 1 })).toEqual(
        expect.objectContaining({ message: 'hi', context: undefined, data: { a: 1 } }),
      );
    });

    it('captures the object-first style info(object, message)', () => {
      expect(capture('log', { a: 1 }, 'hi')).toMatchObject({ message: 'hi', data: { a: 1 } });
    });

    it('still extracts the context name after an object-first call', () => {
      expect(capture('log', { a: 1 }, 'hi', 'Ctx')).toMatchObject({
        message: 'hi',
        context: 'Ctx',
        data: { a: 1 },
      });
    });

    it('captures an object-only call with an empty message', () => {
      expect(capture('log', { a: 1 })).toEqual(
        expect.objectContaining({ message: '', data: { a: 1 } }),
      );
    });

    it('collects multiple payload objects into an array', () => {
      expect(capture('log', { a: 1 }, { b: 2 })).toMatchObject({
        message: '',
        data: [{ a: 1 }, { b: 2 }],
      });
    });

    it('keeps printf interpolation args out of the context name', () => {
      expect(capture('log', '%s did %d things', 'bob', 3, 'Ctx')).toMatchObject({
        message: '%s did %d things',
        context: 'Ctx',
        data: ['bob', 3],
      });
    });

    it('captures non-object extra params as data', () => {
      expect(capture('log', 'hello', 123)).toEqual(
        expect.objectContaining({ message: 'hello', context: undefined, data: 123 }),
      );
    });

    it('ignores the undefined stack hole the NestJS facade inserts on error()', () => {
      expect(capture('error', 'boom', undefined, 'Ctx')).toEqual(
        expect.objectContaining({ message: 'boom', context: 'Ctx', data: undefined }),
      );
    });

    it('captures the NestJS error(message, stack, context) contract', () => {
      const stack = 'Error: boom\n    at handler (file.js:1:1)';
      expect(capture('error', 'boom', stack, 'Ctx')).toMatchObject({
        message: 'boom',
        context: 'Ctx',
        data: { stack },
      });
    });

    it('serializes a leading Error using its message (error(err) style)', () => {
      const entry = capture('error', new Error('kaput'));
      expect(entry).toMatchObject({
        message: 'kaput',
        data: { name: 'Error', message: 'kaput' },
      });
      expect(JSON.stringify(entry.data)).toContain('"stack"');
    });

    it('keeps the explicit message of error(err, message)', () => {
      expect(capture('error', new Error('kaput'), 'failed hard')).toMatchObject({
        message: 'failed hard',
        data: { name: 'Error', message: 'kaput' },
      });
    });

    it('makes the captured payload JSON-safe', () => {
      const payload: Record<string, unknown> = { big: BigInt(2) };
      payload['self'] = payload;
      expect(capture('log', 'hi', payload)).toMatchObject({
        data: { big: '2', self: '[Circular]' },
      });
    });
  });

  describe('delegate context fallback', () => {
    it('reads the context name from the delegate when absent from the args', () => {
      const delegate = { log: jest.fn(), context: 'PostsController' };
      const logger = createProfilerLogger(delegate, profilerService);

      logger.log('hi');

      expect(addLog).toHaveBeenCalledWith(expect.objectContaining({ context: 'PostsController' }));
    });

    it('prefers the context name from the args over the delegate one', () => {
      const delegate = { log: jest.fn(), context: 'PostsController' };
      const logger = createProfilerLogger(delegate, profilerService);

      logger.log('hi', 'Ctx');

      expect(addLog).toHaveBeenCalledWith(expect.objectContaining({ context: 'Ctx' }));
    });

    it('ignores an empty delegate context', () => {
      const delegate = { log: jest.fn(), context: '' };
      const logger = createProfilerLogger(delegate, profilerService);

      logger.log('hi');

      expect(addLog).toHaveBeenCalledWith(expect.objectContaining({ context: undefined }));
    });
  });

  it('still captures level methods the delegate does not implement', () => {
    const partial = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as Record<
      string,
      jest.Mock
    >;
    const logger = createProfilerLogger(partial, profilerService) as Record<
      string,
      (...args: unknown[]) => unknown
    >;

    expect(() => {
      logger['debug']?.('d');
      logger['verbose']?.('v');
      logger['fatal']?.('f');
    }).not.toThrow();
    expect(addLog).toHaveBeenCalledTimes(3);
  });

  it('supports a custom method → level map', () => {
    const delegate = { silly: jest.fn() } as Record<string, jest.Mock>;
    const logger = createProfilerLogger(delegate, profilerService, {
      ...DEFAULT_LOG_METHODS,
      silly: 'verbose',
    });

    logger['silly']?.('noisy');

    expect(addLog).toHaveBeenCalledWith(expect.objectContaining({ level: 'verbose' }));
    expect(delegate['silly']).toHaveBeenCalledWith('noisy');
  });

  it('supports the options form with logMethods', () => {
    const delegate = { silly: jest.fn() } as Record<string, jest.Mock>;
    const logger = createProfilerLogger(delegate, profilerService, {
      logMethods: { ...DEFAULT_LOG_METHODS, silly: 'verbose' },
    });

    logger['silly']?.('noisy');

    expect(addLog).toHaveBeenCalledWith(expect.objectContaining({ level: 'verbose' }));
  });

  it('supports a custom parseArgs for exotic logger conventions', () => {
    const delegate = { log: jest.fn() };
    const logger = createProfilerLogger(delegate, profilerService, {
      parseArgs: (method, args) => ({
        message: `${method}:${String(args[1])}`,
        context: 'Custom',
        data: args[0],
      }),
    });

    logger.log({ a: 1 }, 'hi');

    expect(addLog).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'log:hi', context: 'Custom', data: { a: 1 } }),
    );
    expect(delegate.log).toHaveBeenCalledWith({ a: 1 }, 'hi');
  });
});

describe('parseLogArgs', () => {
  it('classifies an object-first call', () => {
    expect(parseLogArgs('info', [{ a: 1 }, 'hi'], {})).toEqual({
      message: 'hi',
      context: undefined,
      data: { a: 1 },
    });
  });

  it('classifies a message-first call with payload and context name', () => {
    expect(parseLogArgs('log', ['hi', { a: 1 }, 'Ctx'], {})).toEqual({
      message: 'hi',
      context: 'Ctx',
      data: { a: 1 },
    });
  });

  it('stringifies a non-object, non-string head', () => {
    expect(parseLogArgs('log', [42], {})).toEqual({
      message: '42',
      context: undefined,
      data: undefined,
    });
  });
});
