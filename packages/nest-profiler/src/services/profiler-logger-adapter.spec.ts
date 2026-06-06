import { createProfilerLogger, DEFAULT_LOG_METHODS } from './profiler-logger-adapter';
import type { ProfilerService } from './nest-profiler.service';
import type { LogLevel } from '../interfaces/profile.interface';

describe('createProfilerLogger', () => {
  let addLog: jest.Mock;
  let profilerService: Pick<ProfilerService, 'addLog'>;

  beforeEach(() => {
    addLog = jest.fn();
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
      name: 'pino',
    };
    const logger = createProfilerLogger(delegate, profilerService);

    logger.setContext('Ctx');
    expect(delegate.setContext).toHaveBeenCalledWith('Ctx');
    expect(addLog).not.toHaveBeenCalled();
    expect(logger.name).toBe('pino');
  });

  it('stringifies non-string messages', () => {
    const logger = createProfilerLogger({ log: jest.fn() }, profilerService);
    logger.log({ a: 1 });
    expect(addLog).toHaveBeenCalledWith(expect.objectContaining({ message: '[object Object]' }));
  });

  it('leaves context undefined when the last param is not a string', () => {
    const logger = createProfilerLogger({ log: jest.fn() }, profilerService);
    logger.log('hello', 123);
    expect(addLog).toHaveBeenCalledWith(expect.objectContaining({ context: undefined }));
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
});
