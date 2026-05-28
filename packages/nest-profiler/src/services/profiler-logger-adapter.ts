import type { LoggerService } from '@nestjs/common';
import type { LogLevel } from '../interfaces/profile.interface';
import type { ProfilerService } from './nest-profiler.service';

export class ProfilerLoggerAdapter implements LoggerService {
  constructor(
    private readonly delegate: LoggerService,
    private readonly profilerService: ProfilerService,
  ) {}

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.capture('log', message, this.getContext(optionalParams));
    this.delegate.log(message, ...optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.capture('error', message, this.getContext(optionalParams));
    this.delegate.error(message, ...optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.capture('warn', message, this.getContext(optionalParams));
    this.delegate.warn(message, ...optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.capture('debug', message, this.getContext(optionalParams));
    this.delegate.debug?.(message, ...optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.capture('verbose', message, this.getContext(optionalParams));
    this.delegate.verbose?.(message, ...optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.capture('fatal', message, this.getContext(optionalParams));
    this.delegate.fatal?.(message, ...optionalParams);
  }

  private capture(level: LogLevel, message: unknown, context?: string): void {
    this.profilerService.addLog({
      level,
      message: String(message),
      context,
      timestamp: Date.now(),
    });
  }

  private getContext(params: unknown[]): string | undefined {
    const last = params[params.length - 1];
    return typeof last === 'string' ? last : undefined;
  }
}
