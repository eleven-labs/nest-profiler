import type { LogLevel } from '../interfaces/profile.interface';
import type { ProfilerService } from './nest-profiler.service';

/** Method name to profiler log level; extend with custom entries (e.g. winston's 'silly') to support any logger. */
export type LogMethodMap = Record<string, LogLevel>;

/** Built-in method→level map covering NestJS, pino (`info`, `trace`) and winston (`info`). Spread and extend to add more. */
export const DEFAULT_LOG_METHODS: LogMethodMap = {
  log: 'log',
  warn: 'warn',
  error: 'error',
  debug: 'debug',
  verbose: 'verbose',
  fatal: 'fatal',
  info: 'log',
  trace: 'verbose',
};

function extractContext(params: unknown[]): string | undefined {
  const last = params[params.length - 1];
  return typeof last === 'string' ? last : undefined;
}

/** Wraps any logger in a Proxy: captures level-method calls into the active profile and forwards them to the real logger. */
export function createProfilerLogger<T extends object>(
  delegate: T,
  profilerService: Pick<ProfilerService, 'addLog'>,
  logMethods: LogMethodMap = DEFAULT_LOG_METHODS,
): T {
  return new Proxy(delegate, {
    get(target, prop, receiver): unknown {
      const original = Reflect.get(target, prop, receiver) as unknown;

      const level = typeof prop === 'string' ? logMethods[prop] : undefined;
      if (level !== undefined) {
        return (message: unknown, ...optionalParams: unknown[]): unknown => {
          profilerService.addLog({
            level,
            message: String(message),
            context: extractContext(optionalParams),
            timestamp: Date.now(),
          });
          // Forward to the real logger; tolerate loggers that omit optional methods (e.g. no 'fatal').
          if (typeof original === 'function') {
            return (original as (...args: unknown[]) => unknown).apply(target, [
              message,
              ...optionalParams,
            ]);
          }
          return undefined;
        };
      }

      // Transparent passthrough — keep `this` bound to the real logger.
      return typeof original === 'function' ? original.bind(target) : original;
    },
  });
}
