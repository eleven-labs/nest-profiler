import type { LoggerService } from '@nestjs/common';
import { ProfilerLoggerAdapter } from './profiler-logger-adapter';
import type { ProfilerService } from './nest-profiler.service';
import type { LogLevel } from '../interfaces/profile.interface';

function makeDelegate(): jest.Mocked<LoggerService> {
  return {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    fatal: jest.fn(),
  };
}

describe('ProfilerLoggerAdapter', () => {
  let delegate: jest.Mocked<LoggerService>;
  let addLog: jest.Mock;
  let adapter: ProfilerLoggerAdapter;

  beforeEach(() => {
    delegate = makeDelegate();
    addLog = jest.fn();
    adapter = new ProfilerLoggerAdapter(delegate, { addLog } as unknown as ProfilerService);
  });

  const levels: LogLevel[] = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'];

  it.each(levels)('captures the "%s" level and delegates to the underlying logger', (level) => {
    adapter[level]('hello', 'MyContext');

    expect(addLog).toHaveBeenCalledWith(
      expect.objectContaining({ level, message: 'hello', context: 'MyContext' }),
    );
    expect(delegate[level]).toHaveBeenCalledWith('hello', 'MyContext');
  });

  it('stringifies non-string messages', () => {
    adapter.log({ a: 1 });
    expect(addLog).toHaveBeenCalledWith(expect.objectContaining({ message: '[object Object]' }));
  });

  it('leaves context undefined when the last param is not a string', () => {
    adapter.log('hello', 123);
    expect(addLog).toHaveBeenCalledWith(expect.objectContaining({ context: undefined }));
  });

  it('tolerates a delegate missing the optional debug/verbose/fatal methods', () => {
    const partial = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as unknown as LoggerService;
    const partialAdapter = new ProfilerLoggerAdapter(partial, {
      addLog,
    } as unknown as ProfilerService);

    expect(() => {
      partialAdapter.debug('d');
      partialAdapter.verbose('v');
      partialAdapter.fatal('f');
    }).not.toThrow();
    expect(addLog).toHaveBeenCalledTimes(3);
  });
});
