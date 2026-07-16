import { ClsServiceManager } from 'nestjs-cls';
import type { LogEntry, LogLevel, Profile } from '../interfaces/profile.interface';
import { PROFILER_CLS_KEYS } from '../constants';
import { toSafeData } from '../utils/safe-data.utils';

/** Method name to profiler log level; extend with custom entries (e.g. a logger's `silly` or `http` level) to support any logger. */
export type LogMethodMap = Record<string, LogLevel>;

/** Built-in method→level map: the NestJS `LoggerService` methods plus the widespread `info`/`trace` aliases. Spread and extend to add more. */
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

/** A log call decomposed into what the profiler stores on the active profile. */
export interface ParsedLogCall {
  /** Human-readable log message. */
  message: string;
  /** Logger context name, e.g. the class name passed to `new Logger(...)` or `setContext()`. */
  context?: string;
  /** Structured payload extracted from the call arguments; made JSON-safe before storage. */
  data?: unknown;
}

/**
 * Maps a raw log call to the entry stored on the profile. Override via
 * {@link ProfilerLoggerOptions.parseArgs} for loggers whose argument convention
 * the default {@link parseLogArgs} heuristic cannot classify.
 */
export type LogArgsParser = (
  method: string,
  args: readonly unknown[],
  delegate: object,
) => ParsedLogCall;

/** Options accepted by `createProfilerLogger`. */
export interface ProfilerLoggerOptions {
  /** Map overriding which methods are intercepted and at what level. Defaults to {@link DEFAULT_LOG_METHODS}. */
  logMethods?: LogMethodMap;
  /** Custom message/context/data extraction. Defaults to {@link parseLogArgs}. */
  parseArgs?: LogArgsParser;
}

/**
 * Stack-shaped-string heuristic for the NestJS `error(message, stack, context)`
 * contract. `[^\S\n]` (whitespace except `\n`) keeps the match linear-time on
 * attacker-controlled strings of repeated newlines.
 */
const STACK_TRACE = /\n[^\S\n]*at /;
/** Printf-style interpolation tokens commonly supported in log messages. */
const FORMAT_TOKENS = /%[sdifjoO]/g;

function countFormatTokens(message: string): number {
  return message.replace(/%%/g, '').match(FORMAT_TOKENS)?.length ?? 0;
}

function isMergeObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function readDelegateContext(delegate: object): string | undefined {
  if (!('context' in delegate)) {
    return undefined;
  }
  const { context } = delegate;
  return typeof context === 'string' && context.length > 0 ? context : undefined;
}

/**
 * Default {@link LogArgsParser}: classifies the arguments of the common logger conventions,
 * with no logger-specific code — any logger following one of them is supported.
 *
 * - NestJS `LoggerService` (the default standard): `log(message, ...params, context)` —
 *   the trailing string is the context name (what `new Logger(MyService.name)` appends),
 *   including the `error(message, stack, context)` contract.
 * - Object-first structured style: `info(payload, message?, ...interpolationArgs)` and
 *   `error(err, message?)` — object first, message second.
 * - Message-first structured style: `log(message, payloadObject)`.
 *
 * Printf interpolation arguments (counted from `%s`-style tokens in the message) and
 * stack-shaped strings are never mistaken for a context name. When no context name is
 * found in the arguments, the delegate's own `context` property is used as a fallback —
 * for loggers that keep the name given at injection time on the instance. A
 * `(object, string)` call is inherently ambiguous between the object-first convention
 * and a NestJS object-message; the object-first interpretation wins.
 */
export const parseLogArgs: LogArgsParser = (_method, args, delegate) => {
  const [first, ...params] = args;
  let message: string;
  let data: unknown;

  if (isMergeObject(first)) {
    const head = params[0];
    if (typeof head === 'string') {
      message = head;
      params.shift();
    } else {
      message = first instanceof Error ? first.message : '';
    }
    data = first;
  } else {
    switch (typeof first) {
      case 'string':
        message = first;
        break;
      case 'number':
      case 'boolean':
      case 'bigint':
        message = String(first);
        break;
      default:
        message = '';
    }
  }

  const interpolationArgs = params.splice(0, Math.min(countFormatTokens(message), params.length));
  let context: string | undefined;
  const tail = params[params.length - 1];
  if (typeof tail === 'string' && !STACK_TRACE.test(tail)) {
    context = tail;
    params.pop();
  }

  const leftovers = [...interpolationArgs, ...params]
    .filter((value) => value !== undefined)
    .map((value) =>
      typeof value === 'string' && STACK_TRACE.test(value) ? { stack: value } : value,
    );
  if (leftovers.length > 0) {
    const extras = leftovers.length === 1 ? leftovers[0] : leftovers;
    data = data === undefined ? extras : [data, ...leftovers];
  }

  return { message, context: context ?? readDelegateContext(delegate), data };
};

function isLogMethodMap(value: LogMethodMap | ProfilerLoggerOptions): value is LogMethodMap {
  const entries = Object.values(value);
  return entries.length > 0 && entries.every((entry) => typeof entry === 'string');
}

/**
 * Appends a log entry to the active profile, resolved statically from the
 * process-wide CLS singleton — the same store the profiler writes on each
 * request. No DI, so the wrapped logger needs no `ProfilerService`. Outside a
 * profiled context (bootstrap, background job, or profiler disabled) there is no
 * active profile, so the call records nothing and the log still flows through.
 */
function appendLogEntry(entry: LogEntry): void {
  try {
    const profile = ClsServiceManager.getClsService().get<Profile | undefined>(
      PROFILER_CLS_KEYS.profile,
    );
    profile?.logs.push(entry);
  } catch {
    // No active CLS context — transparent pass-through.
  }
}

/**
 * Wraps any logger in a Proxy: captures level-method calls into the active
 * profile (resolved statically from CLS) and forwards them to the real logger.
 *
 * App-owned and DI-free — build it in `main.ts` and pass it to
 * `app.useLogger(...)`, or wherever a logger is needed. It survives the
 * profiler's enable/disable gate: with no active profile it is a transparent
 * pass-through, so log lines are never lost when profiling is off.
 */
export function createProfilerLogger<T extends object>(
  delegate: T,
  logMethodsOrOptions?: LogMethodMap | ProfilerLoggerOptions,
): T {
  const options: ProfilerLoggerOptions =
    logMethodsOrOptions === undefined
      ? {}
      : isLogMethodMap(logMethodsOrOptions)
        ? { logMethods: logMethodsOrOptions }
        : logMethodsOrOptions;
  const logMethods = options.logMethods ?? DEFAULT_LOG_METHODS;
  const parseArgs = options.parseArgs ?? parseLogArgs;

  return new Proxy(delegate, {
    get(target, prop, receiver): unknown {
      const original = Reflect.get(target, prop, receiver) as unknown;

      if (typeof prop === 'string') {
        const level = logMethods[prop];
        if (level !== undefined) {
          return (message: unknown, ...optionalParams: unknown[]): unknown => {
            const parsed = parseArgs(prop, [message, ...optionalParams], target);
            appendLogEntry({
              level,
              message: parsed.message,
              context: parsed.context,
              data: parsed.data === undefined ? undefined : toSafeData(parsed.data),
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
      }

      // Transparent passthrough — keep `this` bound to the real logger.
      return typeof original === 'function' ? original.bind(target) : original;
    },
  });
}
